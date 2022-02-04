import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../replication-endpoints/couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from '../replication-endpoints/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/user-auth.dto';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { RulesService } from '../../../permissions/rules/rules.service';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';

describe('DocumentFilterService', () => {
  let service: DocumentFilterService;
  let normalUser: User;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;
  let mockRulesService: RulesService;
  let mockHttpService: HttpService;
  let mockConfigService: ConfigService;
  const databaseUrl = 'https://couchdb.com';
  const databaseName = 'test-db';

  beforeEach(async () => {
    mockRulesService = {
      getRulesForUser: () => undefined,
    } as any;
    mockHttpService = {
      post: () => of(undefined),
      axiosRef: { defaults: { auth: undefined } },
    } as any;

    const config = {};
    config[CouchDBInteracter.DATABASE_URL_ENV] = databaseUrl;
    config[CouchDBInteracter.DATABASE_NAME_ENV] = databaseName;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentFilterService,
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<DocumentFilterService>(DocumentFilterService);
    normalUser = new User('normalUser', ['user']);

    schoolDoc = getSchoolDoc();
    childDoc = getChildDoc();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter out docs without read permissions in BulkGet', () => {
    const bulkGetResponse = createBulkGetResponse(schoolDoc, childDoc);
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'update', subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result).toEqual(createBulkGetResponse(schoolDoc));
  });

  it('should not filter out deleted documents in bulk get', () => {
    const bulkGetResponse = createBulkGetResponse(childDoc, schoolDoc);
    childDoc._deleted = true;
    schoolDoc._deleted = true;
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'update', subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result).toEqual(bulkGetResponse);
  });

  it('should filter out docs without read permissions in AllDocs', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc, childDoc);
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'Child' }]);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(childDoc));
  });

  it('should not filter out deleted docs in AllDocs', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc, childDoc);
    schoolDoc._deleted = true;
    childDoc._deleted = true;
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'Child' }]);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(schoolDoc, childDoc));
  });

  it('should apply permissions to CREATE operations in BulkDocs', async () => {
    const request: BulkDocsRequest = {
      new_edits: true,
      docs: [childDoc, schoolDoc],
    };
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'create', subject: 'Child' },
      { action: ['read', 'update'], subject: 'School' },
    ]);
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(of({ data: { rows: [] } } as any));

    const result = await service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: true,
      docs: [childDoc],
    });
  });

  it('should apply permissions to UPDATE operations in BulkDocs', async () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [childDoc, schoolDoc],
    };
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'update', subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(
        of({ data: createAllDocsResponse(childDoc, schoolDoc) } as any),
      );

    const result = await service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: false,
      docs: [childDoc],
    });
  });

  it('should apply permissions to DELETE operations in BulkDocs', async () => {
    const deletedChildDoc = getChildDoc();
    deletedChildDoc._deleted = true;
    const deletedSchoolDoc = getSchoolDoc();
    deletedSchoolDoc._deleted = true;
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [deletedChildDoc, deletedSchoolDoc],
    };
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'delete', subject: 'Child' },
      { action: ['read', 'update'], subject: 'School' },
    ]);
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(
        of({ data: createAllDocsResponse(childDoc, schoolDoc) } as any),
      );

    const result = await service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: false,
      docs: [deletedChildDoc],
    });
  });

  it('should check the permissions on the document from the database', async () => {
    const privateSchool = getSchoolDoc();
    privateSchool.privateSchool = true;
    const publicSchool = getSchoolDoc();
    publicSchool._id = 'School:2';
    publicSchool.privateSchool = false;
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'update', subject: 'Child' },
      {
        action: ['update', 'delete'],
        subject: 'School',
        conditions: { privateSchool: false }, // User is only allowed to update/delete public schools
      },
    ]);
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(
        of({ data: createAllDocsResponse(privateSchool, publicSchool) } as any),
      );
    // User makes change to a document on which no permissions are given
    const updatedPrivateSchool = getSchoolDoc();
    updatedPrivateSchool.privateSchool = false;
    updatedPrivateSchool.name = 'Not so Private School';
    // User deletes a document, permissions can't be checked directly
    const deletedPublicSchool: DatabaseDocument = {
      _id: publicSchool._id,
      _rev: publicSchool._rev,
      _revisions: publicSchool._revisions,
      _deleted: true,
    };
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [updatedPrivateSchool, deletedPublicSchool],
    };

    const result = await service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: false,
      docs: [deletedPublicSchool],
    });
  });

  function getSchoolDoc(): DatabaseDocument {
    return {
      _id: 'School:1',
      _rev: 'anotherRev',
      _revisions: { start: 1, ids: ['anotherRev'] },
      anotherProperty: 'anotherValue',
    };
  }

  function getChildDoc(): DatabaseDocument {
    return {
      _id: 'Child:1',
      _rev: 'someRev',
      _revisions: { start: 1, ids: ['someRev'] },
      someProperty: 'someValue',
    };
  }

  function createBulkGetResponse(
    ...documents: DatabaseDocument[]
  ): BulkGetResponse {
    return {
      results: documents.map((doc) => ({
        id: doc._id,
        docs: [{ ok: doc }],
      })),
    };
  }

  function createAllDocsResponse(
    ...documents: DatabaseDocument[]
  ): AllDocsResponse {
    return {
      total_rows: 10,
      offset: 0,
      rows: documents.map((doc) => ({
        id: doc._id,
        key: 'key-' + doc._id,
        value: { rev: schoolDoc._rev },
        doc: doc,
      })),
    };
  }
});
