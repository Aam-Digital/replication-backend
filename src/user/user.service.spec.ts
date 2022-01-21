import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { CouchProxyController } from '../replication/couch-proxy/couch-proxy.controller';
import { ConfigService } from '@nestjs/config';
import {
  Actions,
  detectDocumentType,
  PermissionService,
  Subjects,
} from '../permissions/permission/permission.service';
import { Ability } from '@casl/ability';
import { DocumentRule } from '../permissions/rules/rules.service';
import { UnauthorizedException } from '@nestjs/common';
import { DatabaseDocument, DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../session/session/user-auth.dto';

describe('UserService', () => {
  let service: UserService;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  let mockPermissionService: PermissionService;
  const DATABASE_URL = 'database.url';
  const USERNAME = 'demo';
  const PASSWORD = 'pass';
  const COUCHDB_USERNAME = 'org.couchdb.user:testUser';
  const COUCHDB_USER_URL = DATABASE_URL + '/_users/' + COUCHDB_USERNAME;
  const COUCHDB_USER_OBJECT: DatabaseDocument = {
    _id: COUCHDB_USERNAME,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    derived_key: 'e579375db0e0c6a6fc79cd9e36a36859f71575c3',
    iterations: 10,
    name: 'testUser',
    password_scheme: 'pbkdf2',
    roles: [],
    salt: '1112283cf988a34f124200a050d308a1',
    type: 'user',
  };
  const loggedInUser: User = {
    name: 'testUser',
    roles: [],
  };
  const SUCCESS_RESPONSE: DocSuccess = {
    ok: true,
    id: COUCHDB_USER_OBJECT._id,
    rev: COUCHDB_USER_OBJECT._rev,
  };

  beforeEach(async () => {
    mockHttpService = {
      put: () => of({}),
      axiosRef: { defaults: { auth: undefined } },
    } as any;

    const config = {};
    config[CouchProxyController.DATABASE_USER_ENV] = USERNAME;
    config[CouchProxyController.DATABASE_PASSWORD_ENV] = PASSWORD;
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    mockPermissionService = {
      getAbilityFor: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create ability for passed user', async () => {
    mockAbility([{ subject: 'all', action: 'manage' }]);

    await service.updateUserObject(
      undefined,
      COUCHDB_USER_OBJECT,
      loggedInUser,
    );

    expect(mockPermissionService.getAbilityFor).toHaveBeenCalledWith(
      loggedInUser,
    );
  });

  it('should allow admins to create new users', async () => {
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    mockAbility([
      { subject: 'org.couchdb.user', action: ['create', 'update', 'read'] },
    ]);

    const response = service.updateUserObject(
      undefined,
      COUCHDB_USER_OBJECT,
      loggedInUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      COUCHDB_USER_OBJECT,
    );
  });

  it('should throw an unauthorized exception if user is not allowed to create a new user', () => {
    mockAbility([{ subject: 'org.couchdb.user', action: ['update', 'read'] }]);

    const response = service.updateUserObject(
      undefined,
      COUCHDB_USER_OBJECT,
      loggedInUser,
    );

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  it('should allow admins to update the whole user object', async () => {
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    mockAbility([{ subject: 'org.couchdb.user', action: 'update' }]);
    const userWithUpdatedRoles = Object.assign({}, COUCHDB_USER_OBJECT);
    userWithUpdatedRoles.roles = ['admin_app'];

    const response = service.updateUserObject(
      COUCHDB_USER_OBJECT,
      userWithUpdatedRoles,
      loggedInUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      userWithUpdatedRoles,
    );
  });

  it('should allow normal users to only update their own password', async () => {
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));
    mockAbility([
      {
        subject: 'org.couchdb.user',
        action: 'update',
        fields: 'password',
        conditions: { name: loggedInUser.name },
      },
    ]);
    const userWithUpdatedPassword = Object.assign({}, COUCHDB_USER_OBJECT);
    userWithUpdatedPassword['password'] = 'new_password';
    const updatedPasswordAndRole = Object.assign({}, userWithUpdatedPassword);
    updatedPasswordAndRole.roles = ['admin_app'];

    const response = service.updateUserObject(
      COUCHDB_USER_OBJECT,
      updatedPasswordAndRole,
      loggedInUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      COUCHDB_USER_URL,
      userWithUpdatedPassword,
    );
  });

  it('should not allow normal users to update other users passwords', () => {
    const otherUser = {
      name: 'anotherUser',
      roles: [],
    };
    mockAbility([
      {
        subject: 'org.couchdb.user',
        action: 'update',
        fields: 'password',
        conditions: { name: otherUser.name },
      },
    ]);
    const userWithUpdatedPassword = Object.assign({}, COUCHDB_USER_OBJECT);
    userWithUpdatedPassword['password'] = 'new_password';

    const response = service.updateUserObject(
      COUCHDB_USER_OBJECT,
      userWithUpdatedPassword,
      otherUser,
    );

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  function mockAbility(rules: DocumentRule[]) {
    jest.spyOn(mockPermissionService, 'getAbilityFor').mockReturnValue(
      new Ability<[Actions, Subjects]>(rules, {
        detectSubjectType: detectDocumentType,
      }),
    );
  }
});
