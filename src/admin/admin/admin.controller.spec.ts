import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { RulesService } from '../../permissions/rules/rules.service';
import { of } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';

describe('AdminController', () => {
  let controller: AdminController;
  let mockRulesService: RulesService;
  let mockCouchDBService: CouchdbService;

  beforeEach(async () => {
    mockCouchDBService = {
      post: () => of({}),
      get: () => of({}),
      delete: () => of({}),
    } as any;
    mockRulesService = { loadRules: () => undefined } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: CouchdbService, useValue: mockCouchDBService },
        { provide: RulesService, useValue: mockRulesService },
      ],
    }).compile();

    controller = module.get(AdminController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should trigger a reload of the rules', () => {
    jest.spyOn(mockRulesService, 'loadRules');

    controller.reloadRules('database');

    expect(mockRulesService.loadRules).toHaveBeenCalledWith('database');
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
