import { Test, TestingModule } from '@nestjs/testing';
import { DocumentController } from './document.controller';
import { DocSuccess } from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { COUCHDB_USER_DOC, UserInfo } from '../session/user-auth.dto';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import {
  detectDocumentType,
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { of, throwError } from 'rxjs';
import { DocumentRule } from '../../permissions/rules/rules.service';
import { UnauthorizedException } from '@nestjs/common';
import { Request as Req } from 'express';
import { AxiosResponse } from 'axios';

describe('DocumentController', () => {
  let controller: DocumentController;
  let mockPermissionService: PermissionService;
  let mockCouchDBService: CouchdbService;

  let headers = {};
  const mockReq = {
    header: jest.fn((key: string, value: string) => (headers[key] = value)),
  } as unknown as Req;

  const databaseName = '_users';
  const userDoc = {
    _id: `${COUCHDB_USER_DOC}:testUser`,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    name: 'testUser',
    roles: [],
    type: 'user',
  };
  const requestingUser: UserInfo = new UserInfo('testUser', []);
  const SUCCESS_RESPONSE: DocSuccess = {
    ok: true,
    id: userDoc._id,
    rev: userDoc._rev,
  };

  beforeEach(async () => {
    headers = {};
    mockCouchDBService = {
      get: () => of({}),
      put: () => of({}),
      head: () => of({}),
      delete: () => of({}),
    } as any;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(userDoc));
    jest.spyOn(mockCouchDBService, 'put').mockReturnValue(of(SUCCESS_RESPONSE));
    jest.spyOn(mockCouchDBService, 'head').mockReturnValue(
      of({
        headers: {
          etag: 'etag-value',
          'x-couch-request-id': 'request-id-value',
          'x-couchdb-body-time': 'body-time-value',
        },
      } as unknown as AxiosResponse),
    );

    mockPermissionService = {
      getAbilityFor: () => undefined,
      isAllowedTo: jest.fn(async () => true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    controller = module.get<DocumentController>(DocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create ability for passed user', async () => {
    mockAbility([{ subject: 'all', action: 'manage' }]);
    mockPermissionService.isAllowedTo = jest.fn(async () => true);

    await controller.putDocument(
      mockReq,
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'update',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('putDocument() should set if-match header in _rev property', async () => {
    mockAbility([{ subject: 'all', action: 'manage' }]);

    const req = {
      header: jest.fn((key: string) => {
        if (key === 'if-match') {
          return 'if-match-value';
        }
      }),
    } as unknown as Req;

    await controller.putDocument(
      req,
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    expect(req.header).toHaveBeenNthCalledWith(1, 'if-match');
    expect(req.header).toHaveBeenNthCalledWith(2, 'if-match');
  });

  it('should return the user object if user has read permissions', async () => {
    const response = controller.getDocument(
      databaseName,
      userDoc._id,
      requestingUser,
    );

    await expect(response).resolves.toBe(userDoc);
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      databaseName,
      userDoc._id,
      undefined,
    );
    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'read',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('headDocument() should throw unauthorized exception if user does not have read permission', (done) => {
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'read',
        inverted: true,
      },
    ]);

    controller
      .headDocument(mockReq, databaseName, userDoc._id, requestingUser)
      .subscribe({
        next: () => {
          done('should reject observable');
        },
        error: () => {
          done();
        },
      });
  });

  it('headDocument() should forward header from couchdb response', (done) => {
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'read',
      },
    ]);

    const req = {
      header: jest.fn((key: string, value: string) => (headers[key] = value)),
      res: {
        setHeader: jest.fn(
          (key: string, value: string) => (headers[key] = value),
        ),
      },
    } as unknown as Req;

    controller
      .headDocument(req, databaseName, userDoc._id, requestingUser)
      .subscribe({
        next: () => {
          expect(headers).toStrictEqual({
            ETag: 'etag-value',
            'X-Couch-Request-ID': 'request-id-value',
            'X-CouchDB-Body-Time': 'body-time-value',
          });
          done();
        },
        error: (err) => {
          done(err);
        },
      });
  });

  it('should throw unauthorized exception if user does not have read permission', async () => {
    mockPermissionService.isAllowedTo = jest.fn(async () => false);

    const response = controller.getDocument(
      databaseName,
      userDoc._id,
      requestingUser,
    );

    await expect(response).rejects.toThrow(UnauthorizedException);

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'read',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('should allow create operation if user has permission', async () => {
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));

    const response = controller.putDocument(
      mockReq,
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(databaseName, userDoc);

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'create',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('should throw an unauthorized exception if user does not have create permission', async () => {
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);
    mockPermissionService.isAllowedTo = jest.fn(
      async (action) => action === 'update' || action === 'read',
    );

    const response = controller.putDocument(
      mockReq,
      databaseName,
      userDoc._id,
      userDoc,
      requestingUser,
    );

    await expect(response).rejects.toThrow(UnauthorizedException);

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'create',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('should allow to update a whole document', async () => {
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);
    const userWithUpdatedRoles = Object.assign({}, userDoc);
    userWithUpdatedRoles.roles = ['admin_app'];

    const response = controller.putDocument(
      mockReq,
      databaseName,
      userDoc._id,
      userWithUpdatedRoles,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(
      databaseName,
      userWithUpdatedRoles,
    );

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'update',
      userDoc,
      requestingUser,
      databaseName,
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

    const response = controller.putDocument(
      mockReq,
      databaseName,
      updatedPasswordAndRole._id,
      updatedPasswordAndRole,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(
      databaseName,
      userWithUpdatedPassword,
    );
  });

  it('should throw exception if the update permission is not given', async () => {
    const otherUser: UserInfo = {
      name: 'anotherUser',
      roles: [],
      projects: [],
    };
    mockAbility([
      {
        subject: COUCHDB_USER_DOC,
        action: 'update',
        fields: 'password',
        conditions: { name: otherUser.name },
      },
    ]);
    mockPermissionService.isAllowedTo = jest.fn(async () => false);

    const userWithUpdatedPassword = Object.assign({}, userDoc);
    userWithUpdatedPassword['password'] = 'new_password';

    const response = controller.putDocument(
      mockReq,
      databaseName,
      userDoc._id,
      userWithUpdatedPassword,
      otherUser,
    );

    await expect(response).rejects.toThrow(UnauthorizedException);

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'update',
      userDoc,
      otherUser,
      databaseName,
    );
  });

  it('should throw exception if user is not allowed to delete a doc', async () => {
    mockPermissionService.isAllowedTo = jest.fn(
      async (action) => action !== 'delete',
    );
    jest.spyOn(mockCouchDBService, 'delete');

    const response = controller.deleteDocument(
      databaseName,
      userDoc._id,
      requestingUser,
      { rev: userDoc._rev },
    );

    await expect(response).rejects.toThrow(UnauthorizedException);
    expect(mockCouchDBService.delete).not.toHaveBeenCalled();

    expect(mockPermissionService.isAllowedTo).toHaveBeenCalledWith(
      'delete',
      userDoc,
      requestingUser,
      databaseName,
    );
  });

  it('should allow a permitted user to delete a doc', async () => {
    mockPermissionService.isAllowedTo = jest.fn(async () => true);
    jest.spyOn(mockCouchDBService, 'delete');

    await controller.deleteDocument(databaseName, userDoc._id, requestingUser, {
      rev: userDoc._rev,
    });

    expect(mockCouchDBService.delete).toHaveBeenCalledWith(
      databaseName,
      userDoc._id,
      { rev: userDoc._rev },
    );
  });

  function mockAbility(rules: DocumentRule[]) {
    jest
      .spyOn(mockPermissionService, 'getAbilityFor')
      .mockReturnValue(
        new DocumentAbility(rules, { detectSubjectType: detectDocumentType }),
      );
  }
});
