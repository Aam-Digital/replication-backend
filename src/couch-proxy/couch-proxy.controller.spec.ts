import { Test, TestingModule } from '@nestjs/testing';
import { CouchProxyController } from './couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { BulkGetResponse } from './couch-interfaces/bulk-get';
import { AllDocsResponse } from './couch-interfaces/all-docs';

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
      filterBulkGetDocuments: () => null,
      filterAllDocsDocuments: () => null,
    };

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
      .spyOn(documentFilter, 'filterBulkGetDocuments')
      .mockReturnValue(filteredResponse);
    controller.userRoles = ['user'];

    const result = await firstValueFrom(controller.bulkPost(null, null, null));

    expect(documentFilter.filterBulkGetDocuments).toHaveBeenCalledWith(
      httpServiceResponse.data,
      ['user'],
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
      .spyOn(documentFilter, 'filterAllDocsDocuments')
      .mockReturnValue(filteredResponse);
    controller.userRoles = ['user'];

    const result = await firstValueFrom(controller.allDocs(null, null, null));

    expect(documentFilter.filterAllDocsDocuments).toHaveBeenCalledWith(
      httpServiceResponse.data,
      ['user'],
    );
    expect(result).toEqual(filteredResponse);
  });
});
