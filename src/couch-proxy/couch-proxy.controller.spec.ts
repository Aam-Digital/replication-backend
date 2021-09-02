import { Test, TestingModule } from '@nestjs/testing';
import { CouchProxyController } from './couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from './couchdb-dtos/bulk-docs.dto';
import { COUCH_ENDPOINT } from '../app.module';

describe('CouchProxyController', () => {
  let controller: CouchProxyController;
  let mockHttpService: HttpService;
  let documentFilter: DocumentFilterService;

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
    } as any;

    documentFilter = {
      accessControlList: [],
      transformBulkGetResponse: () => null,
      transformAllDocsResponse: () => null,
      filterBulkDocsRequest: () => null,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouchProxyController],
      providers: [
        { provide: HttpService, useValue: mockHttpService },
        { provide: DocumentFilterService, useValue: documentFilter },
      ],
    }).compile();

    controller = module.get<CouchProxyController>(CouchProxyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should use the document filter service in bulkGet', async () => {
    const httpServiceResponse = {
      data: {
        results: [
          { id: 'someID', doc: [] },
          { id: 'otherID', doc: [] },
        ],
      },
    };
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(of(httpServiceResponse as any));
    const filteredResponse: BulkGetResponse = {
      results: [{ id: 'someID', docs: [] }],
    };
    jest
      .spyOn(documentFilter, 'transformBulkGetResponse')
      .mockReturnValue(filteredResponse);

    const result = await firstValueFrom(controller.bulkPost(null, null, null));

    expect(documentFilter.transformBulkGetResponse).toHaveBeenCalledWith(
      httpServiceResponse.data,
    );
    expect(result).toEqual(filteredResponse);
  });

  it('should use the document filter service in allDocs', async () => {
    const httpServiceResponse = {
      data: {
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
      },
    };
    jest
      .spyOn(mockHttpService, 'post')
      .mockReturnValue(of(httpServiceResponse as any));
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
      .spyOn(documentFilter, 'transformAllDocsResponse')
      .mockReturnValue(filteredResponse);

    const result = await firstValueFrom(controller.allDocs(null, null, null));

    expect(documentFilter.transformAllDocsResponse).toHaveBeenCalledWith(
      httpServiceResponse.data,
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
    jest.spyOn(mockHttpService, 'post');
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
      .mockReturnValue(filteredRequest);

    await firstValueFrom(controller.bulkDocs('db', request));

    expect(documentFilter.filterBulkDocsRequest).toHaveBeenCalledWith(request);
    expect(mockHttpService.post).toHaveBeenCalledWith(
      `${COUCH_ENDPOINT}/db/_bulk_docs`,
      filteredRequest,
      { auth: { password: 'pass', username: 'demo' } },
    );
  });
});
