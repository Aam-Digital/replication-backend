import { Test } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { defer, NEVER, of, throwError } from 'rxjs';
import { Permission } from './permission';
import { ConfigService } from '@nestjs/config';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { ChangesResponse } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/changes.dto';
import { AdminService } from '../../admin/admin.service';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockCouchDBService: CouchdbService;
  let mockAdminService: AdminService;

  let testPermission: Permission;
  let changesResponse: ChangesResponse;

  const normalUser = new UserInfo('normalUser', ['user_app']);
  const adminUser = new UserInfo('superUser', ['user_app', 'admin_app']);
  const DATABASE_NAME = 'app';

  beforeEach(async () => {
    testPermission = new Permission({
      user_app: [
        { action: 'read', subject: 'Note' },
        { action: 'read', subject: 'Child', inverted: true },
      ],
      admin_app: [{ action: 'manage', subject: 'all' }],
    });
    userRules = testPermission.data[normalUser.roles[0]];
    adminRules = testPermission.data[adminUser.roles[1]];

    changesResponse = {
      last_seq: 'initial_seq',
      results: [
        { doc: testPermission, seq: '', changes: [], id: testPermission._id },
      ],
      pending: 0,
    };
    mockCouchDBService = {
      get: () => undefined,
    } as any;
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValueOnce(of(changesResponse))
      .mockReturnValueOnce(NEVER);

    mockAdminService = {
      clearLocal: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            [RulesService.ENV_PERMISSION_DB]: DATABASE_NAME,
          }),
        },
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: AdminService, useValue: mockAdminService },
      ],
    }).compile();

    service = module.get(RulesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fetch the rules from the db on startup', () => {
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      DATABASE_NAME,
      '_changes',
      expect.anything(),
    );
    expect(service.getRulesForUser(normalUser)).toEqual(userRules);
    expect(service.getRulesForUser(adminUser)).toEqual(
      userRules.concat(adminRules),
    );
  });

  it('should retry loading the rules if it fails', () => {
    jest.useFakeTimers();
    let calls = 0;
    jest.spyOn(console, 'error').mockImplementation();
    const newPermissions = new Permission({
      [normalUser.roles[0]]: [{ action: 'manage', subject: 'Child' }],
    });
    const newResponse: ChangesResponse = {
      last_seq: 'new_seq',
      results: [{ ...changesResponse.results[0], doc: newPermissions }],
      pending: 0,
    };

    jest
      .spyOn(mockCouchDBService, 'get')
      .mockImplementation((db, path, params) =>
        defer(() => {
          calls++;
          if (calls < 3) {
            return throwError(() => new Error());
          } else if (params.since === 'new_seq') {
            return NEVER;
          } else {
            return of(newResponse);
          }
        }),
      );

    service.loadRulesContinuously('app');
    jest.advanceTimersByTime(30000);

    // 2x error, 1x success, 1x waiting for next change
    expect(calls).toEqual(4);
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      'LOAD RULES ERROR:',
      expect.any(Error),
    );
    expect(service.getRulesForUser(normalUser)).toEqual(
      newPermissions.data[normalUser.roles[0]],
    );
    jest.useRealTimers();
  });

  it('should not fail if no rules exist for a given role', () => {
    const result = service.getRulesForUser(
      new UserInfo('specialUser', ['user_app', 'non_existing_role']),
    );
    expect(result).toEqual(userRules);
  });

  it('should prepend the default rules', () => {
    const defaultRule: DocumentRule = { subject: 'Config', action: 'read' };
    testPermission.data.default = [defaultRule];

    let result = service.getRulesForUser(normalUser);
    expect(result).toEqual([defaultRule].concat(userRules));

    result = service.getRulesForUser(adminUser);
    expect(result).toEqual([defaultRule].concat(userRules, adminRules));
  });

  it('should inject user properties', () => {
    testPermission.data[normalUser.roles[0]] = [
      {
        subject: 'User',
        action: 'read',
        conditions: { name: '${user.name}' },
      },
    ];

    const rules = service.getRulesForUser(normalUser);

    expect(rules).toEqual([
      {
        subject: 'User',
        action: 'read',
        conditions: { name: normalUser.name },
      },
    ]);
  });

  it('should throw an error if a unknown variable is encountered', () => {
    testPermission.data[normalUser.roles[0]] = [
      {
        subject: 'User',
        action: 'update',
        conditions: { name: '${user.notExistingProperty}' },
      },
    ];
    expect(() => service.getRulesForUser(normalUser)).toThrow(ReferenceError);
  });

  it("should only return 'public' rules if no user object is passed", () => {
    testPermission.data.default = [{ subject: 'Config', action: 'read' }];
    const publicRule: DocumentRule = { subject: 'User', action: 'create' };
    testPermission.data.public = [publicRule];

    const result = service.getRulesForUser(undefined);

    expect(result).toEqual([publicRule]);
    expect(result).not.toContain(testPermission.data.default);
  });

  it('should update rules and call clear_local when permission doc changed', () => {
    jest.useFakeTimers();

    const updatedPermission = new Permission({
      user_app: [{ action: 'manage', subject: 'all' }],
    });
    const updatedPermissionChange = {
      last_seq: '1',
      results: [
        {
          doc: updatedPermission,
          seq: '1',
          changes: [],
          id: updatedPermission._id,
        },
      ],
      pending: 0,
    };

    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValueOnce(of(changesResponse))
      .mockReturnValueOnce(of(updatedPermissionChange))
      .mockReturnValue(NEVER);

    service.loadRulesContinuously('app');
    jest.advanceTimersByTime(1500);

    expect(service.getRulesForUser(normalUser)).toEqual([
      { action: 'manage', subject: 'all' },
    ]);
    expect(mockAdminService.clearLocal).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
