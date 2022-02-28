import { Test, TestingModule } from '@nestjs/testing';
import { ReplicationEndpointsController } from './replication-endpoints.controller';
import { firstValueFrom, of } from 'rxjs';
import { BulkDocumentService } from '../bulk-document/bulk-document.service';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from './couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/user-auth.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';

describe('ReplicationEndpointsController', () => {
  let controller: ReplicationEndpointsController;
  let mockCouchDBService: CouchdbService;
  let documentFilter: BulkDocumentService;
  const DATABASE_NAME = 'app';

  beforeEach(async () => {
    mockCouchDBService = {
      post: () => of({}),
      get: () => of({}),
      delete: () => of({}),
    } as any;

    documentFilter = {
      filterBulkGetResponse: () => null,
      filterAllDocsResponse: () => null,
      filterBulkDocsRequest: () => null,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReplicationEndpointsController],
      providers: [
        CouchdbService,
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: BulkDocumentService, useValue: documentFilter },
      ],
    }).compile();

    controller = module.get<ReplicationEndpointsController>(
      ReplicationEndpointsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should use the document filter service in bulkGet', async () => {
    const bulkGetResponse = {
      results: [
        { id: 'someID', doc: [] },
        { id: 'otherID', doc: [] },
      ],
    };
    jest.spyOn(mockCouchDBService, 'post').mockReturnValue(of(bulkGetResponse));
    const filteredResponse: BulkGetResponse = {
      results: [{ id: 'someID', docs: [] }],
    };
    jest
      .spyOn(documentFilter, 'filterBulkGetResponse')
      .mockReturnValue(filteredResponse);
    const user = new User('username', ['user']);

    const result = await firstValueFrom(
      controller.bulkGetPost(null, null, null, { user: user } as any),
    );

    expect(documentFilter.filterBulkGetResponse).toHaveBeenCalledWith(
      bulkGetResponse,
      user,
    );
    expect(result).toEqual(filteredResponse);
  });

  it('should use the document filter service in allDocs', async () => {
    const allDocsResponse = {
      total_rows: 10,
      offset: 0,
      rows: [
        {
          id: 'someID',
          key: 'someKey',
          value: { rev: 'someRev' },
          doc: null,
        },
        {
          id: 'otherID',
          key: 'otherKey',
          value: { rev: 'otherRev' },
          doc: null,
        },
      ],
    };
    jest.spyOn(mockCouchDBService, 'post').mockReturnValue(of(allDocsResponse));
    const filteredResponse: AllDocsResponse = {
      total_rows: 10,
      offset: 0,
      rows: [
        {
          id: 'someID',
          key: 'someKey',
          value: { rev: 'someRev' },
          doc: null,
        },
      ],
    };
    jest
      .spyOn(documentFilter, 'filterAllDocsResponse')
      .mockReturnValue(filteredResponse);
    const user = new User('username', ['user']);

    const result = await firstValueFrom(
      controller.allDocs('db', null, { user: user } as any, null),
    );

    expect(documentFilter.filterAllDocsResponse).toHaveBeenCalledWith(
      allDocsResponse,
      user,
    );
    expect(result).toEqual(filteredResponse);
  });

  it('should use the document filter service in _bulk_docs', async () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [
        {
          _id: 'Child:1',
          _rev: 'someRev',
          _revisions: { start: 1, ids: ['someRev'] },
          someProperty: 'someValue',
        },
        {
          _id: 'School:1',
          _rev: 'anotherRev',
          _revisions: { start: 1, ids: ['anotherRev'] },
          anotherProperty: 'anotherProperty',
        },
      ],
    };
    jest.spyOn(mockCouchDBService, 'post');
    const filteredRequest: BulkDocsRequest = {
      new_edits: false,
      docs: [
        {
          _id: 'School:1',
          _rev: 'anotherRev',
          _revisions: { start: 1, ids: ['anotherRev'] },
          anotherProperty: 'anotherProperty',
        },
      ],
    };
    jest
      .spyOn(documentFilter, 'filterBulkDocsRequest')
      .mockReturnValue(Promise.resolve(filteredRequest));
    const user = new User('username', ['admin']);

    await firstValueFrom(
      controller.bulkDocs('db', request, { user: user } as any),
    );

    expect(documentFilter.filterBulkDocsRequest).toHaveBeenCalledWith(
      request,
      user,
      'db',
    );
    expect(mockCouchDBService.post).toHaveBeenCalledWith(
      'db',
      '_bulk_docs',
      filteredRequest,
    );
  });

  it('should delete all docs in the _local db', async () => {
    const mockAllDocsResponse = {
      rows: [
        { id: '_local/firstDoc' },
        { id: '_local/secondDoc' },
        { id: '_local/thirdDoc' },
      ],
    };
    jest
      .spyOn(mockCouchDBService, 'get')
      .mockReturnValue(of(mockAllDocsResponse));
    jest.spyOn(mockCouchDBService, 'delete').mockReturnValue(of(undefined));

    const result = await controller.clearLocal(DATABASE_NAME);

    expect(mockCouchDBService.get).toHaveBeenCalledWith(
      DATABASE_NAME,
      '_local_docs',
    );
    mockAllDocsResponse.rows.forEach((row) => {
      expect(mockCouchDBService.delete).toHaveBeenCalledWith(
        DATABASE_NAME,
        row.id,
      );
    });
    expect(result).toBe(true);
  });
});
