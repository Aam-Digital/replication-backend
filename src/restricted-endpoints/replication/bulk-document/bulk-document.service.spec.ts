import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { RulesService } from '../../../permissions/rules/rules.service';
import { UserInfo } from '../../session/user-auth.dto';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { BulkDocumentService } from './bulk-document.service';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AuditService } from '../../../audit/audit.service';

describe('BulkDocumentService', () => {
  let service: BulkDocumentService;
  let normalUser: UserInfo;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;
  let mockAuditService: { recordBulkWrite: jest.Mock };

  beforeEach(async () => {
    mockAuditService = { recordBulkWrite: jest.fn() };
    mockRulesService = {
      getRulesForUser: () => [
        { action: 'update', subject: 'Child' },
        { action: 'read', subject: 'School' },
      ],
    } as any;
    mockCouchDBService = {
      post: () => of({}),
    } as any;
    normalUser = new UserInfo('user-id', 'normalUser', ['user']);
    schoolDoc = getSchoolDoc();
    childDoc = getChildDoc();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkDocumentService,
        PermissionService,
        DocumentFilterService,
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: RulesService, useValue: mockRulesService },
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: AuditService, useValue: mockAuditService },
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

  it('should filter out docs without read permissions in response', () => {
    const result = service.filterFindResponse(
      {
        docs: [getSchoolDoc(), getChildDoc(), getReportDoc()],
        bookmark: '',
      },
      normalUser,
    );

    expect(result.docs.length).toBe(1);
    expect(result.docs[0]._id).toBe('School:1');
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

  it('should pass through error rows (missing keys) in AllDocs without crashing', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc);
    // CouchDB returns rows without an `id` for unknown keys
    const errorRow = { key: 'School:missing', error: 'not_found' } as any;
    allDocsResponse.rows.push(errorRow);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result.rows).toContain(errorRow);
    expect(result.rows).toHaveLength(2);
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

  it('should filter out _design/ docs in BulkGet', () => {
    const designDoc: DatabaseDocument = {
      _id: '_design/some-view',
      _rev: 'rev1',
    };
    const bulkGetResponse = createBulkGetResponse(schoolDoc, designDoc);
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'all' }]);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result.results.map((r) => r.id)).toEqual([schoolDoc._id]);
  });

  it('should filter out _design/ docs in AllDocs', () => {
    const designDoc: DatabaseDocument = {
      _id: '_design/conflicts',
      _rev: 'rev1',
    };
    const allDocsResponse = createAllDocsResponse(schoolDoc, designDoc);
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'all' }]);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result.rows.map((r) => r.id)).toEqual([schoolDoc._id]);
  });

  it('should filter out _design/ docs in BulkDocs writes', async () => {
    const designDoc: DatabaseDocument = {
      _id: '_design/search_index',
      _rev: 'rev1',
    };
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [childDoc, designDoc],
    };
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of(createAllDocsResponse(childDoc)));

    const result = await service.filterBulkDocsRequest(request, normalUser, '');

    expect(result.docs.map((d) => d._id)).toEqual([childDoc._id]);
  });

  it('should filter out _design/ docs in Find responses', () => {
    const designDoc: DatabaseDocument = {
      _id: '_design/some-index',
      _rev: 'rev1',
    };
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'all' }]);

    const result = service.filterFindResponse(
      { docs: [getSchoolDoc(), designDoc], bookmark: '' },
      normalUser,
    );

    expect(result.docs.map((d) => d._id)).toEqual([schoolDoc._id]);
  });

  it('writes filtered docs and audits the write on handleBulkDocs', async () => {
    const updatedChild = getChildDoc();
    updatedChild._rev = '2-new';
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [updatedChild],
    };
    const existingChild = getChildDoc();
    const bulkResponse: any[] = [];
    jest.spyOn(mockCouchDBService, 'post').mockImplementation((_db, path) => {
      if (path === '_all_docs') {
        return of(createAllDocsResponse(existingChild));
      }
      // _bulk_docs with new_edits:false returns only failures (none here)
      return of(bulkResponse);
    });

    await service.handleBulkDocs(request, normalUser, 'app');

    // the filtered docs are actually written to the source db
    expect(mockCouchDBService.post).toHaveBeenCalledWith('app', '_bulk_docs', {
      new_edits: false,
      docs: [updatedChild],
    });

    // the write is handed to the audit service: source db, filtered request,
    // the pre-write existing docs, the couch response and the user
    expect(mockAuditService.recordBulkWrite).toHaveBeenCalledTimes(1);
    const [db, written, existingDocs, response, user] =
      mockAuditService.recordBulkWrite.mock.calls[0];
    expect(db).toBe('app');
    expect(written).toEqual({ new_edits: false, docs: [updatedChild] });
    expect(existingDocs).toBeInstanceOf(Map);
    expect(existingDocs.get('Child:1')).toEqual(existingChild);
    expect(response).toBe(bulkResponse);
    expect(user).toBe(normalUser);
  });

  it('audits only the permission-filtered docs, not the rejected ones', async () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [childDoc, schoolDoc],
    };
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of(createAllDocsResponse(childDoc, schoolDoc)));

    await service.handleBulkDocs(request, normalUser, 'app');

    // normalUser may update Child but not School, so only Child is audited
    const written = mockAuditService.recordBulkWrite.mock.calls[0][1];
    expect(written.docs.map((d: DatabaseDocument) => d._id)).toEqual([
      'Child:1',
    ]);
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

  function getReportDoc(): DatabaseDocument {
    return {
      _id: 'Report:1',
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
        id: doc._id!,
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
        id: doc._id!,
        key: 'key-' + doc._id,
        value: { rev: doc._rev! },
        doc: doc,
      })),
    };
  }
});
