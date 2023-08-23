import { Test, TestingModule } from '@nestjs/testing';
import { InfoEndpointsController } from './info-endpoints.controller';
import { of } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';

describe('InfoEndpointsController', () => {
  let controller: InfoEndpointsController;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      post: () => of({}),
      get: () => of({}),
      put: () => of({}),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InfoEndpointsController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    controller = module.get<InfoEndpointsController>(InfoEndpointsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
