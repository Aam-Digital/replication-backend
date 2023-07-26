import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { of } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { authGuardMockProviders } from '../../auth/auth-guard-mock.providers';

describe('AdminController', () => {
  let controller: AdminController;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      get: () => of({}),
      delete: () => of({}),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    controller = module.get(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
    const dbName = 'app';

    const result = await controller.clearLocal(dbName);

    expect(mockCouchDBService.get).toHaveBeenCalledWith(dbName, '_local_docs');
    mockAllDocsResponse.rows.forEach((row) => {
      expect(mockCouchDBService.delete).toHaveBeenCalledWith(dbName, row.id);
    });
    expect(result).toBe(true);
  });
});
