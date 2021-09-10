import { Test, TestingModule } from '@nestjs/testing';
import { CouchProxyController } from './couch-proxy.controller';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, of } from 'rxjs';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from './couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';
import { ConfigService } from '@nestjs/config';

describe('CouchProxyController', () => {
  let controller: CouchProxyController;
  let mockHttpService: HttpService;
  let documentFilter: DocumentFilterService;
  let mockConfigService: ConfigService;
  const DATABASE_URL = 'database.url';
  const DATABASE_NAME = 'app';
  const USERNAME = 'demo';
  const PASSWORD = 'pass';

  beforeEach(async () => {
    mockHttpService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
      delete: () => of({}),
    } as any;

    documentFilter = {
      accessControlList: [],
      transformBulkGetResponse: () => null,
      transformAllDocsResponse: () => null,
      filterBulkDocsRequest: () => null,
    } as any;

    const config = {};
    config[CouchProxyController.DATABASE_USER_ENV] = USERNAME;
    config[CouchProxyController.DATABASE_PASSWORD_ENV] = PASSWORD;
    config[CouchProxyController.DATABASE_URL_ENV] = DATABASE_URL;
    config[CouchProxyController.DATABASE_NAME_ENV] = DATABASE_NAME;
    mockConfigService = {
      get: jest.fn((key) => config[key]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CouchProxyController],
      providers: [
        { provide: HttpService, useValue: mockHttpService },
        { provide: DocumentFilterService, useValue: documentFilter },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    controller = module.get<CouchProxyController>(CouchProxyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should load the variables from the config', () => {
    expect(mockConfigService.get).toHaveBeenCalledWith(
      CouchProxyController.DATABASE_USER_ENV,
    );
    expect(mockConfigService.get).toHaveBeenCalledWith(
      CouchProxyController.DATABASE_PASSWORD_ENV,
    );
    expect(mockConfigService.get).toHaveBeenCalledWith(
      CouchProxyController.DATABASE_URL_ENV,
    );
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
    const user: User = { name: 'username', roles: ['user'] };

    const result = await firstValueFrom(
      controller.bulkPost(null, null, { user: user } as any),
    );

    expect(documentFilter.transformBulkGetResponse).toHaveBeenCalledWith(
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
      .spyOn(documentFilter, 'transformAllDocsResponse')
      .mockReturnValue(filteredResponse);
    const user: User = { name: 'username', roles: ['user'] };

    const result = await firstValueFrom(
      controller.allDocs(null, null, { user: user } as any),
    );

    expect(documentFilter.transformAllDocsResponse).toHaveBeenCalledWith(
      httpServiceResponse.data,
      ['user'],
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
    const user: User = { name: 'username', roles: ['admin'] };

    await firstValueFrom(controller.bulkDocs(request, { user: user } as any));

    expect(documentFilter.filterBulkDocsRequest).toHaveBeenCalledWith(request, [
      'admin',
    ]);
    expect(mockHttpService.post).toHaveBeenCalledWith(
      `${DATABASE_URL}/${DATABASE_NAME}/_bulk_docs`,
      filteredRequest,
      { auth: { username: USERNAME, password: PASSWORD } },
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
      .spyOn(mockHttpService, 'get')
      .mockReturnValue(of({ data: mockAllDocsResponse } as any));
    jest.spyOn(mockHttpService, 'delete').mockReturnValue(of(undefined));

    const result = await controller.clearLocal();

    expect(mockHttpService.get).toHaveBeenCalledWith(
      `${DATABASE_URL}/${DATABASE_NAME}/_local_docs`,
      { auth: { username: USERNAME, password: PASSWORD } },
    );
    mockAllDocsResponse.rows.forEach((row) => {
      expect(mockHttpService.delete).toHaveBeenCalledWith(
        `${DATABASE_URL}/${DATABASE_NAME}/${row.id}`,
        { auth: { username: USERNAME, password: PASSWORD } },
      );
    });
    expect(result).toBe(true);
  });
});
