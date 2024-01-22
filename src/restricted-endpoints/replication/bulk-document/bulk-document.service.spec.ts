import { Test, TestingModule } from '@nestjs/testing';
import { BulkDocumentService } from './bulk-document.service';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from './couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { RulesService } from '../../../permissions/rules/rules.service';
import { of } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';

describe('BulkDocumentService', () => {
  let service: BulkDocumentService;
  let normalUser: UserInfo;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockRulesService = {
      getRulesForUser: () => [
        { action: 'update', subject: 'Child' },
        { action: 'read', subject: 'School' },
      ],
    } as any;
    mockCouchDBService = {
      post: () => of({}),
    } as any;
    normalUser = new UserInfo('normalUser', ['user']);
    schoolDoc = getSchoolDoc();
    childDoc = getChildDoc();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkDocumentService,
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    service = module.get<BulkDocumentService>(BulkDocumentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter out docs without read permissions in BulkGet', () => {
    const bulkGetResponse = createBulkGetResponse(schoolDoc, childDoc);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result).toEqual(createBulkGetResponse(schoolDoc));
  });

  it('should not filter out deleted documents in bulk get', () => {
    const bulkGetResponse = createBulkGetResponse(childDoc, schoolDoc);
    childDoc._deleted = true;
    schoolDoc._deleted = true;

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
    jest.spyOn(mockCouchDBService, 'post').mockReturnValue(of({ rows: [] }));

    const result = await service.filterBulkDocsRequest(request, normalUser, '');

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
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of(createAllDocsResponse(childDoc, schoolDoc)));

    const result = await service.filterBulkDocsRequest(request, normalUser, '');

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
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of(createAllDocsResponse(childDoc, schoolDoc)));

    const result = await service.filterBulkDocsRequest(request, normalUser, '');

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
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of(createAllDocsResponse(privateSchool, publicSchool)));
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

    const result = await service.filterBulkDocsRequest(request, normalUser, '');

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
