import { Test, TestingModule } from '@nestjs/testing';
import { DocumentRule, RulesService } from './rules.service';
import { COUCHDB_USER_DOC, User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of, throwError } from 'rxjs';
import { Permission } from './permission';
import { CouchProxyController } from '../../replication/couch-proxy/couch-proxy.controller';
import { ConfigService } from '@nestjs/config';
import { DatabaseDocument } from '../../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import {
  detectDocumentType,
  DocumentAbility,
} from '../permission/permission.service';

describe('RulesService', () => {
  let service: RulesService;
  let adminRules: DocumentRule[];
  let userRules: DocumentRule[];
  let mockHttpService: HttpService;
  let testPermission: Permission;
  const DATABASE_URL = 'database.url';
  const DATABASE_NAME = 'app';

  beforeEach(async () => {
    testPermission = new Permission({
      user_app: [
        { action: 'read', subject: 'Aser' },
        { action: 'read', subject: 'Child', inverted: true },
      ],
      admin_app: [{ action: 'manage', subject: 'all' }],
    });
    mockHttpService = {
      get: () => of({ data: testPermission }),
      axiosRef: { defaults: { auth: undefined } },
    } as any;
    jest.spyOn(mockHttpService, 'get');

    const config = {};
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    config[CouchProxyController.DATABASE_NAME_ENV] = DATABASE_NAME;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: new ConfigService(config) },
      ],
    }).compile();

    service = module.get<RulesService>(RulesService);
    await firstValueFrom(service.loadRules());

    userRules = testPermission.rulesConfig['user_app'];
    adminRules = testPermission.rulesConfig['admin_app'];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should fetch the rules from the db', () => {
    expect(mockHttpService.get).toHaveBeenCalledWith(
      `${DATABASE_URL}/${DATABASE_NAME}/${Permission.DOC_ID}`,
    );
  });

  it('should allow everything in case no rules object could be found', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));

    await firstValueFrom(service.loadRules());

    expect(service.getRulesForUser(new User('some-user', []))).toContainEqual({
      subject: 'all',
      action: 'manage',
    });
  });

  it('should return the rules for every passed user role', () => {
    let result = service.getRulesForUser(new User('normalUser', ['user_app']));

    userRules.forEach((rule) => expect(result).toContainEqual(rule));
    adminRules.forEach((rule) => expect(result).not.toContainEqual(rule));

    result = service.getRulesForUser(
      new User('superUser', ['user_app', 'admin_app']),
    );
    userRules
      .concat(adminRules)
      .forEach((rule) => expect(result).toContainEqual(rule));
  });

  it('should not fail if no rules exist for a given role', () => {
    const result = service.getRulesForUser(
      new User('specialUser', ['user_app', 'manager_app']),
    );
    userRules.forEach((rule) => expect(result).toContainEqual(rule));
  });

  it('should return a ability that does not allow to modify the permission document', () => {
    const rules = service.getRulesForUser(new User('someUser', ['admin_app']));
    const ability = new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    const permissionDoc: Permission = {
      _id: `Permission:${Permission.DOC_ID}`,
      _rev: 'someRev',
      rulesConfig: {},
    };
    expect(ability.cannot('create', permissionDoc)).toBe(true);
    expect(ability.cannot('update', permissionDoc)).toBe(true);
    expect(ability.cannot('delete', permissionDoc)).toBe(true);
    expect(ability.can('read', permissionDoc)).toBe(true);
  });

  it('should return a ability where normal users can only read their own user doc and update their password', () => {
    const testUser = new User('someUser', []);
    const rules = service.getRulesForUser(testUser);
    const ability = new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    const userDoc: DatabaseDocument = {
      _id: `${COUCHDB_USER_DOC}:${testUser.name}`,
      _rev: 'someRev',
      name: testUser.name,
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
    const user = new User('some-user', ['another_role']);
    const permissionWithVariable: Permission = new Permission({
      another_role: [
        {
          subject: 'User',
          action: 'read',
          conditions: { name: '${user.name}' },
        },
      ],
    });
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: permissionWithVariable } as any));

    await firstValueFrom(service.loadRules());
    const rules = service.getRulesForUser(user);

    expect(rules).toContainEqual({
      subject: 'User',
      action: 'read',
      conditions: { name: user.name },
    });
  });
});
