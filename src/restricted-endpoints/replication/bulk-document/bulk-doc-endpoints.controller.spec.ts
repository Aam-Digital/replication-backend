import { Test, TestingModule } from '@nestjs/testing';
import { Readable, Writable } from 'stream';
import { BulkDocEndpointsController } from './bulk-doc-endpoints.controller';
import { firstValueFrom } from 'rxjs';
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
      results: [
        { id: 'permittedID', docs: [{ ok: { _id: 'permittedID' } }] },
      ],
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
