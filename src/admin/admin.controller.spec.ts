import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { CouchdbService } from '../couchdb/couchdb.service';
import { authGuardMockProviders } from '../auth/auth-guard-mock.providers';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let controller: AdminController;
  let mockAdminService: CouchdbService;

  beforeEach(async () => {
    mockAdminService = {
      clearLocal: () => Promise.resolve(),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        ...authGuardMockProviders,
        { provide: AdminService, useValue: mockAdminService },
      ],
    }).compile();

    controller = module.get(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
