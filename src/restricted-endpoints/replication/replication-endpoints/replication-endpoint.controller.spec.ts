import { Test, TestingModule } from '@nestjs/testing';
import { ReplicationEndpointsController } from './replication-endpoints.controller';
import { firstValueFrom, of } from 'rxjs';
import { BulkDocumentService } from '../bulk-document/bulk-document.service';
import { BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from './couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';

describe('ReplicationEndpointsController', () => {
  let controller: ReplicationEndpointsController;
  let mockCouchDBService: CouchdbService;
  let documentFilter: BulkDocumentService;

  beforeEach(async () => {
    mockCouchDBService = {
      post: () => of({}),
      get: () => of({}),
    } as any;

    documentFilter = {
      filterBulkGetResponse: () => null,
      filterAllDocsResponse: () => null,
      filterBulkDocsRequest: () => null,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReplicationEndpointsController],
      providers: [
        ...authGuardMockProviders,
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

  it('should overwrite the `include_docs` param in the changes feed', () => {
    jest.spyOn(mockCouchDBService, 'get');

    controller
      .changes('someDB', { since: 'now', include_docs: true })
      .subscribe();

    expect(mockCouchDBService.get).toHaveBeenCalledWith('someDB', '_changes', {
      since: 'now',
      include_docs: false,
    });
  });

  it('should use the document filter service in bulkGet', async () => {
    const bulkGetResponse: BulkGetResponse = {
      results: [
        { id: 'someID', docs: [] },
        { id: 'otherID', docs: [] },
      ],
    };
    jest.spyOn(mockCouchDBService, 'post').mockReturnValue(of(bulkGetResponse));
    const filteredResponse: BulkGetResponse = {
      results: [{ id: 'someID', docs: [] }],
    };
    jest
      .spyOn(documentFilter, 'filterBulkGetResponse')
      .mockReturnValue(filteredResponse);
    const user = new UserInfo('username', ['user']);

    const result = await firstValueFrom(
      controller.bulkGetPost(null, null, null, user),
    );

    expect(documentFilter.filterBulkGetResponse).toHaveBeenCalledWith(
      bulkGetResponse,
      user,
    );
    expect(result).toEqual(filteredResponse);
  });

  it('should use the document filter service in allDocs', async () => {
    const allDocsResponse: AllDocsResponse = {
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
    const user = new UserInfo('username', ['user']);

    const result = await firstValueFrom(
      controller.allDocs('db', null, user, null),
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
    const user = new UserInfo('username', ['admin']);

    await firstValueFrom(controller.bulkDocs('db', request, user));

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
});
