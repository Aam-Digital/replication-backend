import { Test } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { defer, of, throwError } from 'rxjs';
import { Permission } from './permission';
import { ConfigService } from '@nestjs/config';
import { CouchdbService } from '../../couchdb/couchdb.service';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockCouchDBService: CouchdbService;
  let testPermission: Permission;
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
    mockCouchDBService = {
      get: () => undefined,
    } as any;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(testPermission));

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
      Permission.DOC_ID,
    );
  });

  it('should retry loading the rules if it fails', () => {
    jest.useFakeTimers();
    let calls = 0;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
      defer(() => {
        calls++;
        if (calls < 3) {
          return throwError(() => new Error());
        } else return of(testPermission);
      }),
    );

    service.loadRulesContinuously('app');
    jest.advanceTimersByTime(30000);

    expect(calls).toEqual(3);
    expect(service.getRulesForUser(normalUser)).toEqual(userRules);
    jest.useRealTimers();
  });

  it('should allow everything in case no rules object could be found', async () => {
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    jest.useFakeTimers();

    const prom = service.loadRulesContinuously(DATABASE_NAME);
    jest.advanceTimersByTime(60000);

    await expect(prom).rejects.toBeDefined();
    expect(service.getRulesForUser(normalUser)).toEqual([
      { subject: 'all', action: 'manage' },
    ]);
    jest.useRealTimers();
  });

  it('should repeat loading of rules every 60 seconds', () => {
    jest.useFakeTimers();
    let subscribeCalled = 0;
    const otherPermissions = new Permission({
      user_app: testPermission.data['admin_app'],
    });
    (mockCouchDBService.get as any).mockReturnValue(
      defer(() =>
        ++subscribeCalled === 1 ? of(testPermission) : of(otherPermissions),
      ),
    );

    service.loadRulesContinuously('app');

    expect(subscribeCalled).toBe(1);
    expect(service.getRulesForUser(normalUser)).toEqual(userRules);
    jest.advanceTimersByTime(60000);
    expect(subscribeCalled).toBe(2);
    expect(service.getRulesForUser(normalUser)).toEqual(adminRules);

    jest.advanceTimersByTime(30000);
    expect(subscribeCalled).toBe(2);
    jest.advanceTimersByTime(30000);
    expect(subscribeCalled).toBe(3);

    jest.useRealTimers();
  });

  it('should return the rules for every passed user role', () => {
    let result = service.getRulesForUser(normalUser);

    userRules.forEach((rule) => expect(result).toContainEqual(rule));
    adminRules.forEach((rule) => expect(result).not.toContainEqual(rule));

    result = service.getRulesForUser(adminUser);
    expect(result).toEqual(userRules.concat(adminRules));
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
    const permissionWithVariable = new Permission({
      [normalUser.roles[0]]: [
        {
          subject: 'User',
          action: 'read',
          conditions: { name: '${user.name}' },
        },
      ],
    });
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(of(permissionWithVariable));

    service.loadRulesContinuously(DATABASE_NAME);
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
    const permission = new Permission({
      [normalUser.roles[0]]: [
        {
          subject: 'User',
          action: 'update',
          conditions: { name: '${user.notExistingProperty}' },
        },
      ],
    });
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(permission));
    service.loadRulesContinuously(DATABASE_NAME);
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
});
