import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../couch-proxy/couch-interfaces/bulk-get';

describe('DocumentFilterService', () => {
  let service: DocumentFilterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentFilterService],
    }).compile();

    service = module.get<DocumentFilterService>(DocumentFilterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter documents of bulkGet response by their entity', () => {
    const bulkGetResponse: BulkGetResponse = {
      results: [
        {
          id: 'Child:1',
          doc: [],
        },
        {
          id: 'School:1',
          doc: [],
        },
      ],
    };
    service.accessControlList = [{ entity: 'Child', roles: ['admin'] }];

    const result = service.filterBulkGetDocuments(bulkGetResponse, ['user']);

    expect(result).toEqual({
      results: [
        {
          id: 'School:1',
          doc: [],
        },
      ],
    });
  });
});
