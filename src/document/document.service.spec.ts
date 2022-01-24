import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from './document.service';
import { of, throwError } from 'rxjs';
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
import { DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { COUCHDB_USER_DOC, User } from '../session/session/user-auth.dto';

describe('DocumentService', () => {
  let service: DocumentService;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  let mockPermissionService: PermissionService;
  const DATABASE_URL = 'database.url';
  const USERNAME = 'demo';
  const PASSWORD = 'pass';
  const databaseName = '_users';
  const userDoc = {
    _id: `${COUCHDB_USER_DOC}:testUser`,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    name: 'testUser',
    roles: [],
    type: 'user',
  };
  const userURL = `${DATABASE_URL}/${databaseName}/${userDoc._id}`;
  const requestingUser: User = {
    name: 'testUser',
    roles: [],
  };
  const SUCCESS_RESPONSE: DocSuccess = {
    ok: true,
    id: userDoc._id,
    rev: userDoc._rev,
  };

  beforeEach(async () => {
    mockHttpService = {
      put: () => of(undefined),
      get: () => of(undefined),
      axiosRef: { defaults: { auth: undefined } },
    } as any;
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: userDoc } as any));
    jest
      .spyOn(mockHttpService, 'put')
      .mockReturnValue(of({ data: SUCCESS_RESPONSE } as any));

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
        DocumentService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    service = module.get<DocumentService>(DocumentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create ability for passed user', async () => {
    mockAbility([{ subject: 'all', action: 'manage' }]);

    await service.putDocument(
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    expect(mockPermissionService.getAbilityFor).toHaveBeenCalledWith(
      requestingUser,
    );
  });

  it('should return the user object if user has read permissions', async () => {
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'read',
        conditions: { name: requestingUser.name },
      },
    ]);

    const response = service.getDocument(
      databaseName,
      userDoc._id,
      requestingUser,
    );

    await expect(response).resolves.toBe(userDoc);
    expect(mockHttpService.get).toHaveBeenCalledWith(userURL);
  });

  it('should throw unauthorized exception if user does not have read permission', async () => {
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'read',
        inverted: true,
      },
    ]);

    const response = service.getDocument(
      databaseName,
      userDoc._id,
      requestingUser,
    );

    await expect(response).rejects.toThrow(UnauthorizedException);
  });

  it('should allow create operation if user has permission', async () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['create', 'read'] }]);

    const response = service.putDocument(
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(userURL, userDoc);
  });

  it('should throw an unauthorized exception if user does not have create permission', () => {
    jest
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);

    const response = service.putDocument(
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  it('should allow to update a whole document', async () => {
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);
    const userWithUpdatedRoles = Object.assign({}, userDoc);
    userWithUpdatedRoles.roles = ['admin_app'];

    const response = service.putDocument(
      databaseName,
      userDoc._id,
      userWithUpdatedRoles,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      userURL,
      userWithUpdatedRoles,
    );
  });

  it('should enforce field restrictions when updating a document', async () => {
    // User is only allowed to update the 'password' property
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: ['update', 'read'],
        fields: 'password',
        conditions: { name: requestingUser.name },
      },
    ]);
    const userWithUpdatedPassword = Object.assign({}, userDoc);
    userWithUpdatedPassword['password'] = 'new_password';
    const updatedPasswordAndRole = Object.assign({}, userWithUpdatedPassword);
    updatedPasswordAndRole.roles = ['admin_app'];

    const response = service.putDocument(
      databaseName,
      userDoc._id,
      updatedPasswordAndRole,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockHttpService.put).toHaveBeenCalledWith(
      userURL,
      userWithUpdatedPassword,
    );
  });

  it('should throw exception if the update permission is not given', () => {
    const otherUser = {
      name: 'anotherUser',
      roles: [],
    };
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'update',
        fields: 'password',
        conditions: { name: otherUser.name },
      },
    ]);
    const userWithUpdatedPassword = Object.assign({}, userDoc);
    userWithUpdatedPassword['password'] = 'new_password';

    const response = service.putDocument(
      databaseName,
      userDoc._id,
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
