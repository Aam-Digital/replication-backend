import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import {
  COUCHDB_USER_DOC,
  User,
} from '../../restricted-endpoints/session/user-auth.dto';
import { of, throwError } from 'rxjs';
import { Permission } from './permission';
import { ConfigService } from '@nestjs/config';
import { DatabaseDocument } from '../../restricted-endpoints/replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import {
  detectDocumentType,
  DocumentAbility,
} from '../permission/permission.service';
import { CouchdbService } from '../../couchdb/couchdb.service';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockCouchDBService: CouchdbService;
  let testPermission: Permission;
  const normalUser = new User('normalUser', ['user_app']);
  const adminUser = new User('superUser', ['user_app', 'admin_app']);
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

    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<RulesService>(RulesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fetch the rules from the db on startup', async () => {
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      DATABASE_NAME,
      Permission.DOC_ID,
    );
  });

  it('should allow everything in case no rules object could be found', async () => {
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));

    await service.loadRules(DATABASE_NAME);

    expect(service.getRulesForUser(normalUser)).toContainEqual({
      subject: 'all',
      action: 'manage',
    });
  });

  it('should return the rules for every passed user role', () => {
    let result = service.getRulesForUser(normalUser);

    userRules.forEach((rule) => expect(result).toContainEqual(rule));
    adminRules.forEach((rule) => expect(result).not.toContainEqual(rule));

    result = service.getRulesForUser(adminUser);
    userRules
      .concat(adminRules)
      .forEach((rule) => expect(result).toContainEqual(rule));
  });

  it('should not fail if no rules exist for a given role', () => {
    const result = service.getRulesForUser(
      new User('specialUser', ['user_app', 'non_existing_role']),
    );
    userRules.forEach((rule) => expect(result).toContainEqual(rule));
  });

  it('should return an ability that does not allow to modify the permission document', () => {
    const rules = service.getRulesForUser(adminUser);
    const ability = new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    const permissionDoc: Permission = {
      _id: `Permission:${Permission.DOC_ID}`,
      _rev: 'someRev',
      data: {},
    };
    expect(ability.cannot('create', permissionDoc)).toBe(true);
    expect(ability.cannot('update', permissionDoc)).toBe(true);
    expect(ability.cannot('delete', permissionDoc)).toBe(true);
    expect(ability.can('read', permissionDoc)).toBe(true);
  });

  it('should return an ability where normal users can only read their own user doc and update their password', () => {
    const rules = service.getRulesForUser(normalUser);
    const ability = new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    const userDoc: DatabaseDocument = {
      _id: `${COUCHDB_USER_DOC}:${normalUser.name}`,
      _rev: 'someRev',
      name: normalUser.name,
    };

    const otherUserDoc: DatabaseDocument = {
      _id: `${COUCHDB_USER_DOC}:otherUser`,
      _rev: 'otherRev',
      name: 'otherUser',
    };

    expect(ability.can('read', userDoc)).toBe(true);
    expect(ability.can('update', userDoc, 'password')).toBe(true);
    expect(ability.cannot('update', userDoc, 'roles')).toBe(true);
    expect(ability.cannot('create', userDoc)).toBe(true);
    expect(ability.cannot('delete', userDoc)).toBe(true);
    expect(ability.cannot('read', otherUserDoc)).toBe(true);
    expect(ability.cannot('update', otherUserDoc)).toBe(true);
    expect(ability.cannot('update', otherUserDoc, 'password')).toBe(true);
    expect(ability.cannot('create', otherUserDoc)).toBe(true);
    expect(ability.cannot('delete', otherUserDoc)).toBe(true);
  });

  it('should inject user properties', async () => {
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

    await service.loadRules(DATABASE_NAME);
    const rules = service.getRulesForUser(normalUser);

    expect(rules).toContainEqual({
      subject: 'User',
      action: 'read',
      conditions: { name: normalUser.name },
    });
  });

  it('should throw an error if a unknown variable is encountered', async () => {
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
    await service.loadRules(DATABASE_NAME);
    expect(() => service.getRulesForUser(normalUser)).toThrow(ReferenceError);
  });
});
