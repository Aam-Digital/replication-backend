import { Test, TestingModule } from '@nestjs/testing';
import { ReplicationEndpointsController } from './replication-endpoints.controller';
import { of } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';

describe('ReplicationEndpointsController', () => {
  let controller: ReplicationEndpointsController;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReplicationEndpointsController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
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
});
