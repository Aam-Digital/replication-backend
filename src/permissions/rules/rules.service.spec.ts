import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { of, Subject, throwError } from 'rxjs';
import { AdminService } from '../../admin/admin.service';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { ChangeResult } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/changes.dto';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { Permission } from './permission';
import { DocumentRule, RulesService } from './rules.service';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockAdminService: AdminService;
  let mockUserIdentityService: UserIdentityService;
  let mockCouchdbService: CouchdbService;
  let changesSubject: Subject<ChangeResult>;

  let testPermission: Permission;

  const normalUser = new UserInfo('user-normal', 'normalUser', ['user_app']);
  const adminUser = new UserInfo('user-super', 'superUser', [
    'user_app',
    'admin_app',
  ]);
  const DATABASE_NAME = 'app';

  beforeEach(async () => {
    testPermission = new Permission({
      user_app: [
        { action: 'read', subject: 'Note' },
        { action: 'read', subject: 'Child', inverted: true },
      ],
      admin_app: [{ action: 'manage', subject: 'all' }],
    });
    userRules = testPermission.data[normalUser.roles[0]]!;
    adminRules = testPermission.data[adminUser.roles[1]]!;

    changesSubject = new Subject<ChangeResult>();

    mockAdminService = {
      clearLocal: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockUserIdentityService = {
      clearCache: jest.fn(),
    } as any;

    mockCouchdbService = {
      get: jest.fn().mockReturnValue(of(testPermission)),
    } as any;

    const mockDocumentChangesService = {
      getChanges: jest.fn().mockReturnValue(changesSubject),
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
        { provide: AdminService, useValue: mockAdminService },
        { provide: UserIdentityService, useValue: mockUserIdentityService },
        { provide: CouchdbService, useValue: mockCouchdbService },
        {
          provide: DocumentChangesService,
          useValue: mockDocumentChangesService,
        },
      ],
    }).compile();

    service = module.get(RulesService);
    await service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should load rules from initial permission document during init', () => {
    expect(service.getRulesForUser(normalUser)).toEqual(userRules);
    expect(service.getRulesForUser(adminUser)).toEqual(
      userRules.concat(adminRules),
    );
    expect(mockCouchdbService.get).toHaveBeenCalledWith(
      DATABASE_NAME,
      Permission.DOC_ID,
    );
  });

  it('should ignore changes for non-permission documents', () => {
    changesSubject.next({
      doc: { _id: 'Child:1' },
      seq: '2',
      changes: [{ rev: '1-a' }],
      id: 'Child:1',
    });

    // Rules should remain unchanged
    expect(service.getRulesForUser(normalUser)).toEqual(userRules);
  });

  it('should not fail if no rules exist for a given role', () => {
    const result = service.getRulesForUser(
      new UserInfo('user-special', 'specialUser', [
        'user_app',
        'non_existing_role',
      ]),
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
        conditions: {
          name: '${user.name}',
          id: '${user.id}',
          entityId: '${user.entityId}',
        },
      },
    ];

    const rules = service.getRulesForUser(normalUser);

    expect(rules).toEqual([
      {
        subject: 'User',
        action: 'read',
        conditions: {
          name: normalUser.name,
          id: normalUser.id,
          entityId: normalUser.name,
        },
      },
    ]);
  });

  it('should log a warning and replace with null if a unknown variable is encountered', () => {
    testPermission.data[normalUser.roles[0]] = [
      {
        subject: 'User',
        action: 'update',
        conditions: { name: '${user.notExistingProperty}' },
      },
    ];

    const rules = service.getRulesForUser(normalUser);

    expect(rules).toEqual([
      {
        subject: 'User',
        action: 'update',
        conditions: { name: RulesService.USER_PROPERTY_UNDEFINED },
      },
    ]);
  });

  it('should replace undefined user.name with null without errors', () => {
    const userWithoutName = new UserInfo('user-id', undefined as any, [
      'user_app',
    ]);
    testPermission.data[userWithoutName.roles[0]] = [
      {
        subject: 'User',
        action: 'read',
        conditions: { name: '${user.name}' },
      },
    ];

    const rules = service.getRulesForUser(userWithoutName);

    expect(rules).toEqual([
      {
        subject: 'User',
        action: 'read',
        conditions: { name: RulesService.USER_PROPERTY_UNDEFINED },
      },
    ]);
  });

  it("should only return 'public' rules if no user object is passed", () => {
    testPermission.data.default = [{ subject: 'Config', action: 'read' }];
    const publicRule: DocumentRule = { subject: 'User', action: 'create' };
    testPermission.data.public = [publicRule];

    const result = service.getRulesForUser(undefined as any);

    expect(result).toEqual([publicRule]);
    expect(result).not.toContain(testPermission.data.default);
  });

  it('should update rules and call clearCache and clearLocal when permission doc changed', () => {
    jest.useFakeTimers();

    const updatedPermission = new Permission({
      user_app: [{ action: 'manage', subject: 'all' }],
    });

    changesSubject.next({
      doc: updatedPermission,
      seq: '1',
      changes: [],
      id: updatedPermission._id!,
    });

    jest.advanceTimersByTime(1500);

    expect(service.getRulesForUser(normalUser)).toEqual([
      { action: 'manage', subject: 'all' },
    ]);
    expect(mockUserIdentityService.clearCache).toHaveBeenCalled();
    expect(mockAdminService.clearLocal).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('should start without permissions when initial load fails and recover via changes feed', async () => {
    // Create a fresh service whose initial load will fail
    const failingCouchdbService = {
      get: jest
        .fn()
        .mockReturnValue(throwError(() => new Error('connection refused'))),
    } as any;
    const freshChangesSubject = new Subject<ChangeResult>();
    const freshModule = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            [RulesService.ENV_PERMISSION_DB]: DATABASE_NAME,
          }),
        },
        { provide: AdminService, useValue: mockAdminService },
        { provide: UserIdentityService, useValue: mockUserIdentityService },
        { provide: CouchdbService, useValue: failingCouchdbService },
        {
          provide: DocumentChangesService,
          useValue: {
            getChanges: jest.fn().mockReturnValue(freshChangesSubject),
          },
        },
      ],
    }).compile();

    const freshService = freshModule.get(RulesService);
    await freshService.onModuleInit();

    // No permissions loaded — falls back to "allow everything"
    expect(freshService.getRulesForUser(normalUser)).toEqual([
      { subject: 'all', action: 'manage' },
    ]);

    // Permissions arrive via changes feed
    freshChangesSubject.next({
      doc: testPermission,
      seq: '1',
      changes: [{ rev: '1-a' }],
      id: testPermission._id!,
    });

    // Now rules should be available
    expect(freshService.getRulesForUser(normalUser)).toEqual(userRules);
  });

  it('should fail startup when CouchDB rejects credentials with 401', async () => {
    const unauthorizedCouchdbService = {
      get: jest.fn().mockReturnValue(
        throwError(
          () =>
            new HttpException(
              { error: 'unauthorized', reason: 'Name or password is incorrect.' },
              HttpStatus.UNAUTHORIZED,
            ),
        ),
      ),
    } as any;
    const freshModule = await Test.createTestingModule({
      providers: [
        RulesService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            [RulesService.ENV_PERMISSION_DB]: DATABASE_NAME,
          }),
        },
        { provide: AdminService, useValue: mockAdminService },
        { provide: UserIdentityService, useValue: mockUserIdentityService },
        { provide: CouchdbService, useValue: unauthorizedCouchdbService },
        {
          provide: DocumentChangesService,
          useValue: {
            getChanges: jest.fn().mockReturnValue(new Subject<ChangeResult>()),
          },
        },
      ],
    }).compile();

    const freshService = freshModule.get(RulesService);

    await expect(freshService.onModuleInit()).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
