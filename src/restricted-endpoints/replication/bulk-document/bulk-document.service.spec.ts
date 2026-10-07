import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { EMPTY, of } from 'rxjs';
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
import { BulkGetResponse, BulkGetResult } from './couchdb-dtos/bulk-get.dto';
import { AuditService } from '../../../audit/audit.service';
import { AttachmentCleanupService } from '../../../couchdb/attachment-cleanup.service';

describe('BulkDocumentService', () => {
  let service: BulkDocumentService;
  let normalUser: UserInfo;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;
  let mockAuditService: { recordBulkWrite: jest.Mock };
  let mockAttachmentCleanupService: { cleanupForBulkWrite: jest.Mock };

  beforeEach(async () => {
    mockAuditService = { recordBulkWrite: jest.fn() };
    mockAttachmentCleanupService = { cleanupForBulkWrite: jest.fn() };
    mockRulesService = {
      getRulesForUser: () => [
        { action: 'update', subject: 'Child' },
        { action: 'read', subject: 'School' },
      ],
      permissionsChanged$: EMPTY,
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
        {
          provide: AttachmentCleanupService,
          useValue: mockAttachmentCleanupService,
        },
      ],
    }).compile();

    service = module.get<BulkDocumentService>(BulkDocumentService);
  });

  // The streaming endpoints filter responses via the reusable per-item
  // mappers; these helpers apply them to a whole buffered response so the
  // tests exercise the same logic the controllers run.
  const filterBulkGet = (r: BulkGetResponse, u: UserInfo): BulkGetResponse => ({
    results: r.results
      .map(service.bulkGetResultMapper(u))
      .filter((x): x is BulkGetResult => x !== undefined),
  });
  const filterAllDocs = (r: AllDocsResponse, u: UserInfo): AllDocsResponse => ({
    ...r,
    rows: r.rows.filter(service.allDocsRowFilter(u)),
  });
  const filterFind = (
    r: { docs: DatabaseDocument[]; bookmark?: string },
    u: UserInfo,
  ) => ({
    ...r,
    docs: r.docs.filter(service.findDocFilter(u)),
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter out docs without read permissions in BulkGet', () => {
    const bulkGetResponse = createBulkGetResponse(schoolDoc, childDoc);

    const result = filterBulkGet(bulkGetResponse, normalUser);

    expect(result).toEqual(createBulkGetResponse(schoolDoc));
  });

  it('should filter out docs without read permissions in response', () => {
    const result = filterFind(
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

    const result = filterBulkGet(bulkGetResponse, normalUser);

    expect(result).toEqual(bulkGetResponse);
  });

  it('should filter out docs without read permissions in AllDocs', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc, childDoc);
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'Child' }]);

    const result = filterAllDocs(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(childDoc));
  });

  it('should pass through error rows (missing keys) in AllDocs without crashing', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc);
    // CouchDB returns rows without an `id` for unknown keys
    const errorRow = { key: 'School:missing', error: 'not_found' } as any;
    allDocsResponse.rows.push(errorRow);

    const result = filterAllDocs(allDocsResponse, normalUser);

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

    const result = filterAllDocs(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(schoolDoc, childDoc));
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

    const result = filterBulkGet(bulkGetResponse, normalUser);

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

    const result = filterAllDocs(allDocsResponse, normalUser);

    expect(result.rows.map((r) => r.id)).toEqual([schoolDoc._id]);
  });

  it('should filter out _design/ docs in Find responses', () => {
    const designDoc: DatabaseDocument = {
      _id: '_design/some-index',
      _rev: 'rev1',
    };
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'all' }]);

    const result = filterFind(
      { docs: [getSchoolDoc(), designDoc], bookmark: '' },
      normalUser,
    );

    expect(result.docs.map((d) => d._id)).toEqual([schoolDoc._id]);
  });

  describe('handleBulkDocs', () => {
    /**
     * `_all_docs` returns `existing` as the server state; `_bulk_docs` answers
     * like CouchDB, i.e. lists only failures with `new_edits: false`.
     */
    function stubCouchdb({
      existing = [],
      conflicts = [],
    }: { existing?: DatabaseDocument[]; conflicts?: string[] } = {}) {
      jest
        .spyOn(mockCouchDBService, 'post')
        .mockImplementation((_db, path, body: any) => {
          if (path === '_all_docs') {
            return of(createAllDocsResponse(...existing));
          }
          const results = (body as BulkDocsRequest).docs.map((doc) =>
            conflicts.includes(doc._id!)
              ? { id: doc._id, rev: doc._rev, error: 'conflict', reason: 'x' }
              : { ok: true, id: doc._id, rev: '2-new' },
          );
          return of(
            body.new_edits === false ? results.filter((r) => r.error) : results,
          );
        });
    }

    function bulkDocsCalls() {
      return jest
        .mocked(mockCouchDBService.post)
        .mock.calls.filter(([, path]) => path === '_bulk_docs');
    }

    function forwardedIds(): string[] {
      return bulkDocsCalls().flatMap(([, , body]) =>
        (body as BulkDocsRequest).docs.map((d) => d._id!),
      );
    }

    function forbidden(doc: DatabaseDocument) {
      return expect.objectContaining({
        id: doc._id,
        rev: doc._rev,
        error: 'forbidden',
      });
    }

    const deleted = (doc: DatabaseDocument) => ({ ...doc, _deleted: true });

    it.each<[string, any[], DatabaseDocument[], DatabaseDocument[]]>([
      [
        'create',
        [
          { action: 'create', subject: 'Child' },
          { action: ['read', 'update'], subject: 'School' },
        ],
        [],
        [getChildDoc(), getSchoolDoc()],
      ],
      [
        'update',
        [
          { action: 'update', subject: 'Child' },
          { action: 'read', subject: 'School' },
        ],
        [getChildDoc(), getSchoolDoc()],
        [getChildDoc(), getSchoolDoc()],
      ],
      [
        'delete',
        [
          { action: 'delete', subject: 'Child' },
          { action: ['read', 'update'], subject: 'School' },
        ],
        [getChildDoc(), getSchoolDoc()],
        [deleted(getChildDoc()), deleted(getSchoolDoc())],
      ],
    ])(
      'forwards only docs the user may %s',
      async (_action, rules, existing, docs) => {
        jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue(rules);
        stubCouchdb({ existing });

        await service.handleBulkDocs(
          { new_edits: false, docs },
          normalUser,
          'app',
        );

        expect(forwardedIds()).toEqual(['Child:1']);
      },
    );

    it('checks update and delete permissions against the doc in the database', async () => {
      const privateSchool = { ...getSchoolDoc(), privateSchool: true };
      const publicSchool = {
        ...getSchoolDoc(),
        _id: 'School:2',
        privateSchool: false,
      };
      jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
        {
          action: ['update', 'delete'],
          subject: 'School',
          conditions: { privateSchool: false }, // only public schools
        },
      ]);
      stubCouchdb({ existing: [privateSchool, publicSchool] });

      await service.handleBulkDocs(
        {
          new_edits: false,
          docs: [
            // the change itself would be permitted, the stored doc is not
            { ...privateSchool, privateSchool: false },
            // a deletion carries no fields to check
            { _id: publicSchool._id, _rev: publicSchool._rev, _deleted: true },
          ],
        },
        normalUser,
        'app',
      );

      expect(forwardedIds()).toEqual(['School:2']);
    });

    it('returns a result for every submitted doc in its original position', async () => {
      jest
        .spyOn(mockRulesService, 'getRulesForUser')
        .mockReturnValue([{ action: 'create', subject: 'Child' }]);
      stubCouchdb();
      const designDoc = { _id: '_design/search_index' };

      const response = await service.handleBulkDocs(
        { new_edits: true, docs: [schoolDoc, childDoc, designDoc] },
        normalUser,
        'app',
      );

      expect(forwardedIds()).toEqual(['Child:1']);
      expect(response).toEqual([
        forbidden(schoolDoc),
        { ok: true, id: 'Child:1', rev: '2-new' },
        forbidden(designDoc),
      ]);
    });

    it('adds a forbidden result for denied docs to the failures of a replication write', async () => {
      const otherChild = { ...getChildDoc(), _id: 'Child:2' };
      const designDoc = { _id: '_design/search_index', _rev: '1-a' };
      stubCouchdb({
        existing: [childDoc, otherChild, schoolDoc],
        conflicts: ['Child:1'],
      });

      const response = await service.handleBulkDocs(
        {
          new_edits: false,
          docs: [childDoc, schoolDoc, designDoc, otherChild],
        },
        normalUser,
        'app',
      );

      // non-replicable docs are ignored like written ones: no result at all
      expect(forwardedIds()).toEqual(['Child:1', 'Child:2']);
      expect(response).toEqual([
        expect.objectContaining({ id: 'Child:1', error: 'conflict' }),
        forbidden(schoolDoc),
      ]);
    });

    it('does not call CouchDB when no doc may be written', async () => {
      stubCouchdb({ existing: [schoolDoc] });

      const response = await service.handleBulkDocs(
        { new_edits: true, docs: [schoolDoc] },
        normalUser,
        'app',
      );

      expect(response).toEqual([forbidden(schoolDoc)]);
      expect(bulkDocsCalls()).toHaveLength(0);
      expect(mockAuditService.recordBulkWrite).not.toHaveBeenCalled();
      expect(
        mockAttachmentCleanupService.cleanupForBulkWrite,
      ).not.toHaveBeenCalled();
    });

    it("audits and cleans up the forwarded docs against CouchDB's own response", async () => {
      const updatedChild = { ...getChildDoc(), _rev: '2-new' };
      stubCouchdb({ existing: [childDoc, schoolDoc] });

      const response = await service.handleBulkDocs(
        { new_edits: true, docs: [schoolDoc, updatedChild] },
        normalUser,
        'app',
      );

      const forwarded = { new_edits: true, docs: [updatedChild] };
      const couchdbResponse = [{ ok: true, id: 'Child:1', rev: '2-new' }];
      expect(response).toHaveLength(2);
      expect(mockAuditService.recordBulkWrite).toHaveBeenCalledWith(
        'app',
        forwarded,
        expect.any(Map),
        couchdbResponse,
        normalUser,
      );
      const existingDocs = mockAuditService.recordBulkWrite.mock.calls[0][2];
      expect(existingDocs.get('Child:1')).toEqual(childDoc);
      expect(
        mockAttachmentCleanupService.cleanupForBulkWrite,
      ).toHaveBeenCalledWith('app', forwarded, couchdbResponse);
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
