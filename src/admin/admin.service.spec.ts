import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { CouchdbService } from '../couchdb/couchdb.service';
import { of } from 'rxjs';

describe('AdminService', () => {
  let service: AdminService;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      get: () => of({}),
      delete: () => of({}),
    } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: CouchdbService, useValue: mockCouchDBService },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

    await service.clearLocal(dbName);

    expect(mockCouchDBService.get).toHaveBeenCalledWith(dbName, '_local_docs');
    mockAllDocsResponse.rows.forEach((row) => {
      expect(mockCouchDBService.delete).toHaveBeenCalledWith(dbName, row.id);
    });
  });
});
