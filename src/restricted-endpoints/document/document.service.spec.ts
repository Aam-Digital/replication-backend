import { Test, TestingModule } from '@nestjs/testing';
import { DocumentService } from './document.service';
import { of, throwError } from 'rxjs';
import {
  detectDocumentType,
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { DocumentRule } from '../../permissions/rules/rules.service';
import { UnauthorizedException } from '@nestjs/common';
import { DocSuccess } from '../replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { COUCHDB_USER_DOC, User } from '../session/user-auth.dto';
import { CouchdbService } from '../couchdb/couchdb.service';

describe('DocumentService', () => {
  let service: DocumentService;
  let mockPermissionService: PermissionService;
  let mockCouchDBService: CouchdbService;
  const databaseName = '_users';
  const userDoc = {
    _id: `${COUCHDB_USER_DOC}:testUser`,
    _rev: '1-e0ebfb84005b920488fc7a8cc5470cc0',
    name: 'testUser',
    roles: [],
    type: 'user',
  };
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
    mockCouchDBService = {
      get: () => of({}),
      put: () => of({}),
    } as any;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(userDoc));
    jest.spyOn(mockCouchDBService, 'put').mockReturnValue(of(SUCCESS_RESPONSE));

    mockPermissionService = {
      getAbilityFor: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentService,
        { provide: CouchdbService, useValue: mockCouchDBService },
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

    await service.putDocument(databaseName, userDoc, requestingUser);

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
    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      databaseName,
      userDoc._id,
      undefined,
    );
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
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['create', 'read'] }]);

    const response = service.putDocument(databaseName, userDoc, requestingUser);

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(databaseName, userDoc);
  });

  it('should throw an unauthorized exception if user does not have create permission', () => {
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(throwError(() => new Error()));
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);

    const response = service.putDocument(databaseName, userDoc, requestingUser);

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  it('should allow to update a whole document', async () => {
    mockAbility([{ subject: COUCHDB_USER_DOC, action: ['update', 'read'] }]);
    const userWithUpdatedRoles = Object.assign({}, userDoc);
    userWithUpdatedRoles.roles = ['admin_app'];

    const response = service.putDocument(
      databaseName,
      userWithUpdatedRoles,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(
      databaseName,
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
      updatedPasswordAndRole,
      requestingUser,
    );

    await expect(response).resolves.toBe(SUCCESS_RESPONSE);
    expect(mockCouchDBService.put).toHaveBeenCalledWith(
      databaseName,
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
      userWithUpdatedPassword,
      otherUser,
    );

    return expect(response).rejects.toThrow(UnauthorizedException);
  });

  function mockAbility(rules: DocumentRule[]) {
    jest
      .spyOn(mockPermissionService, 'getAbilityFor')
      .mockReturnValue(
        new DocumentAbility(rules, { detectSubjectType: detectDocumentType }),
      );
  }
});
