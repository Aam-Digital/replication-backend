import { Test, TestingModule } from '@nestjs/testing';
import { Readable, Writable } from 'stream';
import { BulkDocEndpointsController } from './bulk-doc-endpoints.controller';
import { firstValueFrom, of } from 'rxjs';
import { BulkDocumentService } from './bulk-document.service';
import { BulkGetResponse, BulkGetResult } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from './couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';

describe('BulkDocEndpointsController', () => {
  let controller: BulkDocEndpointsController;
  let mockCouchDBService: CouchdbService;
  let documentFilter: BulkDocumentService;
  const user = new UserInfo('user-id', 'username', ['user']);

  beforeEach(async () => {
    mockCouchDBService = {
      post: jest.fn(),
      get: jest.fn(),
      postStream: jest.fn(),
      getStream: jest.fn(),
    } as any;

    documentFilter = {
      handleBulkDocs: jest.fn(),
      bulkGetResultMapper: jest.fn(),
      allDocsRowFilter: jest.fn(),
      findDocFilter: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BulkDocEndpointsController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: BulkDocumentService, useValue: documentFilter },
      ],
    }).compile();

    controller = module.get<BulkDocEndpointsController>(
      BulkDocEndpointsController,
    );
  });

  /**
   * Express Response stand-in: a real Writable (so it works with
   * stream.pipeline) capturing the streamed JSON body.
   */
  function createMockResponse() {
    const chunks: string[] = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        (res as any).headersSent = true;
        chunks.push(String(chunk));
        cb();
      },
    }) as any;
    res.headersSent = false;
    res.setHeader = jest.fn();
    res.status = jest.fn(() => res);
    jest.spyOn(res, 'destroy');
    return { res, body: () => JSON.parse(chunks.join('')) };
  }

  function asStream(response: unknown): Readable {
    return Readable.from([JSON.stringify(response)]);
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should stream and filter the _bulk_get response per result', async () => {
    const bulkGetResponse: BulkGetResponse = {
      results: [
        { id: 'permittedID', docs: [{ ok: { _id: 'permittedID' } }] },
        { id: 'forbiddenID', docs: [{ ok: { _id: 'forbiddenID' } }] },
      ],
    };
    jest
      .spyOn(mockCouchDBService, 'postStream')
      .mockResolvedValue(asStream(bulkGetResponse));
    jest
      .spyOn(documentFilter, 'bulkGetResultMapper')
      .mockReturnValue((result: BulkGetResult) =>
        result.id === 'permittedID' ? result : undefined,
      );
    const { res, body } = createMockResponse();

    await controller.bulkGetPost('db', {}, { docs: [] }, user, res);

    expect(mockCouchDBService.postStream).toHaveBeenCalledWith(
      'db',
      '_bulk_get',
      { docs: [] },
      {},
    );
    expect(documentFilter.bulkGetResultMapper).toHaveBeenCalledWith(user);
    expect(body()).toEqual({
      results: [{ id: 'permittedID', docs: [{ ok: { _id: 'permittedID' } }] }],
    });
  });

  it('should stream and filter the _all_docs response per row', async () => {
    const allDocsResponse: AllDocsResponse = {
      total_rows: 10,
      offset: 0,
      rows: [
        { id: 'permittedID', key: 'k1', value: { rev: 'r1' } },
        { id: 'forbiddenID', key: 'k2', value: { rev: 'r2' } },
      ],
    };
    jest
      .spyOn(mockCouchDBService, 'postStream')
      .mockResolvedValue(asStream(allDocsResponse));
    jest
      .spyOn(documentFilter, 'allDocsRowFilter')
      .mockReturnValue((row) => row.id === 'permittedID');
    const { res, body } = createMockResponse();

    await controller.allDocs('db', {}, user, { keys: [] }, res);

    expect(documentFilter.allDocsRowFilter).toHaveBeenCalledWith(user);
    expect(body()).toEqual({
      total_rows: 10,
      offset: 0,
      rows: [{ id: 'permittedID', key: 'k1', value: { rev: 'r1' } }],
    });
  });

  it('should stream the GET _all_docs variant', async () => {
    jest
      .spyOn(mockCouchDBService, 'getStream')
      .mockResolvedValue(
        asStream({ total_rows: 1, offset: 0, rows: [{ id: 'x' }] }),
      );
    jest.spyOn(documentFilter, 'allDocsRowFilter').mockReturnValue(() => true);
    const { res, body } = createMockResponse();

    await controller.allDocsGet('db', { include_docs: 'true' }, user, res);

    expect(mockCouchDBService.getStream).toHaveBeenCalledWith(
      'db',
      '_all_docs',
      { include_docs: 'true' },
    );
    expect(body().rows).toEqual([{ id: 'x' }]);
  });

  it('should stream and filter the _find response per doc', async () => {
    const findResponse = {
      docs: [{ _id: 'Report:1' }, { _id: 'Secret:1' }],
      bookmark: 'abc',
    };
    jest
      .spyOn(mockCouchDBService, 'postStream')
      .mockResolvedValue(asStream(findResponse));
    jest
      .spyOn(documentFilter, 'findDocFilter')
      .mockReturnValue((doc) => doc._id === 'Report:1');
    const { res, body } = createMockResponse();

    const request = { selector: { type: 'report' } };
    await controller.find('db', request, user, res);

    expect(mockCouchDBService.postStream).toHaveBeenCalledWith(
      'db',
      '_find',
      request,
    );
    expect(body()).toEqual({ docs: [{ _id: 'Report:1' }], bookmark: 'abc' });
  });

  it('should use the buffered path, omit skip and filter docs when _find body has a limit', async () => {
    jest.spyOn(mockCouchDBService, 'post').mockReturnValue(
      of({
        docs: [{ _id: 'Report:1' }, { _id: 'Secret:1' }],
        bookmark: 'bm1',
      }),
    );
    jest
      .spyOn(documentFilter, 'findDocFilter')
      .mockReturnValue((doc) => doc._id === 'Report:1');
    const { res, body } = createMockResponse();

    await controller.find('db', { selector: {}, limit: 10 }, user, res);

    expect(mockCouchDBService.post).toHaveBeenCalledWith(
      'db',
      '_find',
      expect.objectContaining({ limit: 50 }), // 10 * INTERNAL_LIMIT_MULTIPLIER
    );
    expect(mockCouchDBService.post).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ skip: expect.anything() }),
    );
    expect(body()).toEqual({ docs: [{ _id: 'Report:1' }], bookmark: 'bm1' });
    
  });

  it('should iterate _find with bookmark when filtered results are below the limit', async () => {
    // limit=5 → internalLimit = 5*5 = 25
    // batch1: exactly 25 forbidden docs → loop continues (25 >= 25) with bookmark
    // batch2: 5 permitted docs, fewer than 25 → loop stops
    const batch1 = {
      docs: Array.from({ length: 25 }, (_, i) => ({ _id: `Forbidden:${i}` })),
      bookmark: 'bm1',
    };
    const batch2 = {
      docs: Array.from({ length: 5 }, (_, i) => ({ _id: `Permitted:${i}` })),
      bookmark: 'bm2',
    };
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValueOnce(of(batch1))
      .mockReturnValueOnce(of(batch2));
    jest
      .spyOn(documentFilter, 'findDocFilter')
      .mockReturnValue((doc) => !!doc._id?.startsWith('Permitted'));
    const { res, body } = createMockResponse();

    await controller.find('db', { selector: {}, limit: 5 }, user, res);

    expect(mockCouchDBService.post).toHaveBeenCalledTimes(2);
    expect(mockCouchDBService.post).toHaveBeenNthCalledWith(
      2,
      'db',
      '_find',
      expect.objectContaining({ bookmark: 'bm1' }),
    );
    const result = body();
    expect(result.docs).toHaveLength(5);
    expect(result.bookmark).toBe('bm2');
  });

  it('should stop iterating _find when CouchDB returns fewer docs than requested', async () => {
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValue(of({ docs: [{ _id: 'Report:1' }], bookmark: 'bm1' }));
    jest.spyOn(documentFilter, 'findDocFilter').mockReturnValue(() => false);
    const { res, body } = createMockResponse();

    await controller.find('db', { selector: {}, limit: 10 }, user, res);

    // Only one call — CouchDB returned 1 < 50 (internal limit), so no more pages
    expect(mockCouchDBService.post).toHaveBeenCalledTimes(1);
    expect(body()).toEqual({ docs: [], bookmark: 'bm1' });
  });

  it('should re-fetch with exact limit when a batch has more permitted docs than needed', async () => {
    // limit=2, internalLimit=10, batch has [P0, F1, P2, F3, P4, F5, P6, F7, P8, F9]
    // allPermitted=[P0,P2,P4,P6,P8], remaining=2 → overflow
    // lastNeededRawIndex = index of P2 = 2 → re-fetch with limit=3
    // re-fetch returns [P0,F1,P2], bookmark='exact-bm'
    const overflowBatch = {
      docs: [
        { _id: 'P:0' },
        { _id: 'F:1' },
        { _id: 'P:2' },
        { _id: 'F:3' },
        { _id: 'P:4' },
        { _id: 'F:5' },
        { _id: 'P:6' },
        { _id: 'F:7' },
        { _id: 'P:8' },
        { _id: 'F:9' },
      ],
      bookmark: 'wide-bm',
    };
    const exactBatch = {
      docs: [{ _id: 'P:0' }, { _id: 'F:1' }, { _id: 'P:2' }],
      bookmark: 'exact-bm',
    };
    jest
      .spyOn(mockCouchDBService, 'post')
      .mockReturnValueOnce(of(overflowBatch))
      .mockReturnValueOnce(of(exactBatch));
    jest
      .spyOn(documentFilter, 'findDocFilter')
      .mockReturnValue((doc) => !!doc._id?.startsWith('P'));
    const { res, body } = createMockResponse();

    await controller.find('db', { selector: {}, limit: 2 }, user, res);

    // Second call must use the exact limit (index 2 + 1 = 3)
    expect(mockCouchDBService.post).toHaveBeenCalledTimes(2);
    expect(mockCouchDBService.post).toHaveBeenNthCalledWith(
      2,
      'db',
      '_find',
      expect.objectContaining({ limit: 3, bookmark: undefined }),
    );
    const result = body();
    expect(result.docs).toEqual([{ _id: 'P:0' }, { _id: 'P:2' }]);
    // bookmark comes from the exact re-fetch, not the wide batch
    expect(result.bookmark).toBe('exact-bm');
  });

  it('should abort the response if the upstream stream fails mid-transfer', async () => {
    const broken = new Readable({
      read() {
        this.push('{"results":[{"id":"a"'); // truncated JSON
        this.push(null);
      },
    });
    jest.spyOn(mockCouchDBService, 'postStream').mockResolvedValue(broken);
    jest
      .spyOn(documentFilter, 'bulkGetResultMapper')
      .mockReturnValue((result) => result);
    const { res } = createMockResponse();

    await controller.bulkGetPost('db', {}, { docs: [] }, user, res);

    expect(res.destroy).toHaveBeenCalled();
  });

  it('should keep the response usable when the upstream body is not a JSON object', async () => {
    jest
      .spyOn(mockCouchDBService, 'postStream')
      .mockResolvedValue(Readable.from(['[1,2,3]']));
    jest
      .spyOn(documentFilter, 'bulkGetResultMapper')
      .mockReturnValue((result) => result);
    const { res } = createMockResponse();

    await expect(
      controller.bulkGetPost('db', {}, { docs: [] }, user, res),
    ).rejects.toThrow(/JSON object/);
    // the exception filter can only send a status while the response is alive
    expect(res.headersSent).toBe(false);
    expect(res.destroyed).toBe(false);
  });

  it('should rethrow upstream errors that occur before headers are sent', async () => {
    jest
      .spyOn(mockCouchDBService, 'postStream')
      .mockRejectedValue(new Error('couchdb down'));
    const { res } = createMockResponse();

    await expect(
      controller.bulkGetPost('db', {}, { docs: [] }, user, res),
    ).rejects.toThrow('couchdb down');
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('should delegate _bulk_docs to the document service (filter + write + audit)', async () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [
        {
          _id: 'Child:1',
          _rev: 'someRev',
          _revisions: { start: 1, ids: ['someRev'] },
          someProperty: 'someValue',
        },
      ],
    };
    const response = [{ ok: true, id: 'Child:1', rev: 'someRev' }];
    jest
      .spyOn(documentFilter, 'handleBulkDocs')
      .mockReturnValue(Promise.resolve(response as any));
    const user = new UserInfo('user-id', 'username', ['admin']);

    const result = await firstValueFrom(
      controller.bulkDocs('db', request, user),
    );

    expect(documentFilter.handleBulkDocs).toHaveBeenCalledWith(
      request,
      user,
      'db',
    );
    expect(result).toEqual(response);
  });
});
