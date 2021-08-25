import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../couch-proxy/couch-interfaces/bulk-get';
import { AllDocsResponse } from '../couch-proxy/couch-interfaces/all-docs';

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

  it('should filter documents of _bulk_docs by their entity', () => {
    const allDocsResponse: AllDocsResponse = {
      total_rows: 0,
      offset: 0,
      rows: [
        {
          id: 'Child:1',
          key: '',
          value: { rev: '' },
          doc: null,
        },
        {
          id: 'School:1',
          key: '',
          value: { rev: '' },
          doc: null,
        },
      ],
    };
    service.accessControlList = [{ entity: 'School', roles: ['admin'] }];

    const result = service.filterAllDocsDocuments(allDocsResponse, ['user']);

    expect(result).toEqual({
      total_rows: 0,
      offset: 0,
      rows: [
        {
          id: 'Child:1',
          key: '',
          value: { rev: '' },
          doc: null,
        },
      ],
    });
  });
});
