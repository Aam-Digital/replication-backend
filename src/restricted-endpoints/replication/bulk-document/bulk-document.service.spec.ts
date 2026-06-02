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
  let mockAuditService: { record: jest.Mock };

  beforeEach(async () => {
    mockAuditService = { record: jest.fn() };
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

  it('writes filtered docs and audits them on handleBulkDocs (new_edits:false)', async () => {
    const updatedChild = getChildDoc();
    updatedChild._rev = '2-new';
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [updatedChild],
    };
    jest.spyOn(mockCouchDBService, 'post').mockImplementation((_db, path) => {
      if (path === '_all_docs') {
        return of(createAllDocsResponse(getChildDoc()));
      }
      // _bulk_docs with new_edits:false returns only failures (none here)
      return of([]);
    });

    await service.handleBulkDocs(request, normalUser, 'app');

    expect(mockAuditService.record).toHaveBeenCalledTimes(1);
    const [db, entries, user] = mockAuditService.record.mock.calls[0];
    expect(db).toBe('app');
    expect(user).toBe(normalUser);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('update');
    expect(entries[0].newRev).toBe('2-new');
    expect(entries[0].existingDoc._id).toBe('Child:1');
  });

  it('audits with rev from the response on the new_edits:true path', async () => {
    const newChild = getChildDoc();
    const request: BulkDocsRequest = {
      new_edits: true,
      docs: [newChild],
    };
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'create', subject: 'Child' },
      { action: 'update', subject: 'Child' },
    ]);
    jest.spyOn(mockCouchDBService, 'post').mockImplementation((_db, path) => {
      if (path === '_all_docs') {
        // no existing doc -> create
        return of({ total_rows: 0, offset: 0, rows: [] });
      }
      // _bulk_docs new_edits:true returns {ok, id, rev} per doc
      return of([{ ok: true, id: 'Child:1', rev: '5-server' }]);
    });

    await service.handleBulkDocs(request, normalUser, 'app');

    expect(mockAuditService.record).toHaveBeenCalledTimes(1);
    const entries = mockAuditService.record.mock.calls[0][1];
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe('create');
    expect(entries[0].newRev).toBe('5-server');
  });

  it('skips conflicted/errored docs when building audit entries', async () => {
    const updatedChild = getChildDoc();
    updatedChild._rev = '2-new';
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [updatedChild],
    };
    jest.spyOn(mockCouchDBService, 'post').mockImplementation((_db, path) => {
      if (path === '_all_docs') {
        return of(createAllDocsResponse(getChildDoc()));
      }
      // _bulk_docs reports this doc as a conflict
      return of([{ id: 'Child:1', error: 'conflict', reason: 'x', rev: '' }]);
    });

    await service.handleBulkDocs(request, normalUser, 'app');

    expect(mockAuditService.record).toHaveBeenCalledTimes(1);
    expect(mockAuditService.record.mock.calls[0][1]).toHaveLength(0);
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
