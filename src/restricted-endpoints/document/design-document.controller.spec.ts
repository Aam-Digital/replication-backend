import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';
import { CouchdbService } from '../../couchdb/couchdb.service';
import {
  detectDocumentType,
  createDocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { DocSuccess } from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../session/user-auth.dto';
import { DesignDocumentController } from './design-document.controller';

describe('DesignDocumentController', () => {
  let controller: DesignDocumentController;
  let mockCouchDBService: CouchdbService;
  let mockPermissionService: PermissionService;

  const requestingUser: UserInfo = new UserInfo('user-id', 'testUser', []);
  const databaseName = 'app';

  const designDoc = {
    _id: '_design/search_index',
    _rev: '1-abc',
    views: {
      by_name: {
        map: '(doc) => { emit(doc.name); }',
      },
    },
  };

  const SUCCESS_RESPONSE: DocSuccess = {
    ok: true,
    id: designDoc._id,
    rev: designDoc._rev,
  };

  const viewResult = {
    total_rows: 3,
    offset: 0,
    rows: [
      {
        id: 'Child:1',
        key: 'Alice',
        value: null,
        doc: { _id: 'Child:1', name: 'Alice' },
      },
      {
        id: 'Child:2',
        key: 'Bob',
        value: null,
        doc: { _id: 'Child:2', name: 'Bob' },
      },
      {
        id: 'Child:3',
        key: 'Charlie',
        value: null,
        doc: { _id: 'Child:3', name: 'Charlie', _deleted: true },
      },
    ],
  };

  /**
   * Express Response stand-in supporting both the buffered `res.json(...)`
   * path and the streamed `res.write`/`res.end` path used by ViewResponseStream.
   */
  function createMockResponse() {
    const chunks: string[] = [];
    const res: any = {
      headersSent: false,
      destroyed: false,
      statusCode: 200,
      setHeader: jest.fn(),
      flush: jest.fn(),
      status: jest.fn((code: number) => {
        res.statusCode = code;
        return res;
      }),
      json: jest.fn((obj: unknown) => {
        res.headersSent = true;
        chunks.push(JSON.stringify(obj));
      }),
      write: jest.fn((chunk: string) => {
        res.headersSent = true;
        chunks.push(String(chunk));
        return true;
      }),
      end: jest.fn(),
      destroy: jest.fn(() => {
        res.destroyed = true;
      }),
    };
    return { res, body: () => JSON.parse(chunks.join('')) };
  }

  beforeEach(async () => {
    mockCouchDBService = {
      get: () => of({}),
      put: () => of({}),
    } as any;
    jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(designDoc));
    jest.spyOn(mockCouchDBService, 'put').mockReturnValue(of(SUCCESS_RESPONSE));

    mockPermissionService = {
      getAbilityFor: () => undefined,
      isAllowedTo: jest.fn(async () => true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DesignDocumentController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: PermissionService, useValue: mockPermissionService },
      ],
    }).compile();

    controller = module.get<DesignDocumentController>(DesignDocumentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDesignDoc', () => {
    it('should fetch the design document from CouchDB', () => {
      controller.getDesignDoc(databaseName, 'search_index', requestingUser);

      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index',
        undefined,
      );
    });
  });

  describe('putDesignDoc', () => {
    const adminAbility = createDocumentAbility(
      [{ action: 'manage', subject: '_design' }],
      { detectSubjectType: detectDocumentType },
    );

    it('should create a design document in CouchDB', async () => {
      mockPermissionService.getAbilityFor = jest.fn(() => adminAbility);

      const result = await controller.putDesignDoc(
        databaseName,
        'search_index',
        { ...designDoc },
        requestingUser,
      );

      expect(result).toBe(SUCCESS_RESPONSE);
      expect(mockCouchDBService.put).toHaveBeenCalledWith(
        databaseName,
        expect.objectContaining({ _id: '_design/search_index' }),
      );
    });

    it('should set the _id from the URL path', async () => {
      mockPermissionService.getAbilityFor = jest.fn(() => adminAbility);
      const docWithoutId = { views: designDoc.views } as any;

      await controller.putDesignDoc(
        databaseName,
        'my_view',
        docWithoutId,
        requestingUser,
      );

      expect(mockCouchDBService.put).toHaveBeenCalledWith(
        databaseName,
        expect.objectContaining({ _id: '_design/my_view' }),
      );
    });

    it('should reject if user lacks manage permission on _design', async () => {
      const readOnlyAbility = createDocumentAbility(
        [{ action: 'read', subject: 'all' }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => readOnlyAbility);

      await expect(
        controller.putDesignDoc(
          databaseName,
          'search_index',
          { ...designDoc },
          requestingUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('queryView (unbounded, no limit given)', () => {
    it('should proxy view query to CouchDB', async () => {
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(of(viewResult));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { key: '"Alice"' },
        res,
      );

      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { key: '"Alice"' },
      );
      expect(body()).toEqual(viewResult);
    });

    it('should filter rows based on user permissions when include_docs is true', async () => {
      const ability = createDocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: 'true' },
        res,
      );

      // Child:1 is readable, Child:2 and Child:3 is not
      const result = body();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('Child:1');
    });

    it('should not filter rows when include_docs is not set', async () => {
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        {},
        res,
      );

      expect(body().rows).toHaveLength(3);
    });

    it('should return all rows when user has full read access', async () => {
      const ability = createDocumentAbility([
        { action: 'manage', subject: 'all' },
      ]);
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { include_docs: 'true' },
        res,
      );

      expect(body().rows).toHaveLength(3);
    });

    it('should pass a limit through unmodified when include_docs is not set (no filtering possible)', async () => {
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of({ total_rows: 3, offset: 0, rows: [] }));
      const { res } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '2', skip: '1' },
        res,
      );

      // no permission filtering can happen without doc content, so this
      // stays a single, unmodified proxy call
      expect(mockCouchDBService.get).toHaveBeenCalledTimes(1);
      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { limit: '2', skip: '1' },
      );
    });

    it('should fall back to a single unmodified call when limit is malformed', async () => {
      const ability = createDocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: 'not-a-number', include_docs: 'true' },
        res,
      );

      expect(mockCouchDBService.get).toHaveBeenCalledTimes(1);
      // include_docs filtering still applies to the buffered result
      // (Child:1 readable, Child:2 and Child:3 denied)
      expect(body().rows).toHaveLength(1);
    });

    it('should treat limit=0 as no limit (below the minimum of 1) and fall back to a single unmodified call', async () => {
      const ability = createDocumentAbility(
        [{ action: 'read', subject: 'Child', conditions: { _id: 'Child:1' } }],
        { detectSubjectType: detectDocumentType },
      );
      mockPermissionService.getAbilityFor = jest.fn(() => ability);
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValue(of(JSON.parse(JSON.stringify(viewResult))));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '0', include_docs: 'true' },
        res,
      );

      // limit=0 fails the positive-limit check, so the pagination loop is
      // never entered; the value is forwarded to CouchDB unmodified
      expect(mockCouchDBService.get).toHaveBeenCalledTimes(1);
      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { limit: '0', include_docs: 'true' },
      );
      // include_docs filtering still applies to the buffered result
      // (Child:1 readable, Child:2 and Child:3 denied)
      expect(body().rows).toHaveLength(1);
    });
  });

  describe('queryView (paginated, limit + include_docs=true)', () => {
      const ability = createDocumentAbility(
        [
          {
            action: 'read',
            subject: 'Child',
            conditions: { readable: true },
          },
        ],
        { detectSubjectType: detectDocumentType },
      );

    function row(id: string, readable: boolean) {
      return { id, key: id, value: null, doc: { _id: id, readable } };
    }

    beforeEach(() => {
        mockPermissionService.getAbilityFor = jest.fn(() => ability);
    })

    it('passes offset through unmodified when nothing gets filtered', async () => {
      // simulate a non-trivial CouchDB-reported offset (e.g. from a startkey
      // seek) to prove we don't recompute it as `skip` ourselves
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
        of({
          total_rows: 100,
          offset: 47,
          rows: [row('Child:1', true), row('Child:2', true)],
        }),
      );
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '2', skip: '5', include_docs: 'true' },
        res,
      );

      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { include_docs: 'true', skip: 5, limit: 10 }, // remaining(2) * INTERNAL_LIMIT_MULTIPLIER(5)
      );
      const result = body();
      expect(result.rows.map((r: any) => r.id)).toEqual(['Child:1', 'Child:2']);
      expect(result.total_rows).toBe(100);
      expect(result.offset).toBe(47); // == firstBatchOffset + 2 - 2
    });

    it('skips over denied rows within a single internal batch and advances offset accordingly', async () => {
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
        of({
          total_rows: 10,
          offset: 0,
          rows: [
            row('Child:1', true),
            row('Child:2', false),
            row('Child:3', true),
            row('Child:4', false),
          ],
        }),
      );
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '2', include_docs: 'true' },
        res,
      );

      // internal limit = 2 * 5 = 10, single call at skip=0
      expect(mockCouchDBService.get).toHaveBeenCalledTimes(1);
      expect(mockCouchDBService.get).toHaveBeenCalledWith(
        databaseName,
        '_design/search_index/_view/by_name',
        { include_docs: 'true', skip: 0, limit: 10 },
      );
      const result = body();
      expect(result.rows.map((r: any) => r.id)).toEqual(['Child:1', 'Child:3']);
      // raw rows examined = 3 (index of Child:1 + 1), permitted returned = 2
      // offset = firstBatchOffset(0) + 3 - 2 = 1
      expect(result.offset).toBe(1);
    });

    it('issues a follow-up internal request when a whole batch is denied', async () => {
      const deniedBatch = {
        total_rows: 20,
        offset: 0,
        rows: Array.from({ length: 10 }, (_, i) => row(`Child:${i}`, false))
      };
      const permittedBatch = {
        total_rows: 20,
        offset: 10,
        rows: [
          row('Child:10', true),
          row('Child:11', true)
        ],
      };
      jest
        .spyOn(mockCouchDBService, 'get')
        .mockReturnValueOnce(of(deniedBatch))
        .mockReturnValueOnce(of(permittedBatch));
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '2', include_docs: 'true' },
        res,
      );

      expect(mockCouchDBService.get).toHaveBeenCalledTimes(2);
      expect(mockCouchDBService.get).toHaveBeenNthCalledWith(
        1,
        databaseName,
        '_design/search_index/_view/by_name',
        { include_docs: 'true', skip: 0, limit: 10 },
      );
      expect(mockCouchDBService.get).toHaveBeenNthCalledWith(
        2,
        databaseName,
        '_design/search_index/_view/by_name',
        { include_docs: 'true', skip: 10, limit: 10 },
      );
      const result = body();
      expect(result.rows.map((r: any) => r.id)).toEqual(['Child:10', 'Child:11']);
      // raw examined = 10 (denied batch) + 2 (permitted batch) = 12
      // offset = firstBatchOffset(0) + 12 - 2 = 10
      expect(result.offset).toBe(10);
    });

    it('stops and returns fewer rows than limit when the view is exhausted', async () => {
      jest.spyOn(mockCouchDBService, 'get').mockReturnValue(
        of({
          total_rows: 1,
          offset: 0,
          rows: [row('Child:OnlyOne', true)],
        }),
      );
      const { res, body } = createMockResponse();

      await controller.queryView(
        databaseName,
        'search_index',
        'by_name',
        requestingUser,
        { limit: '5', include_docs: 'true' },
        res,
      );

      // CouchDB returned 1 row < internal limit(25) -> exhausted after one call
      expect(mockCouchDBService.get).toHaveBeenCalledTimes(1);
      const result = body();
      expect(result.rows.map((r: any) => r.id)).toEqual(['Child:OnlyOne']);
      expect(result.offset).toBe(0);
    });
  });
});
