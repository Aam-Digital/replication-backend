import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { SessionService } from '../session/session/session.service';

describe('DocumentFilterService', () => {
  let service: DocumentFilterService;
  let mockSessionService: SessionService;

  beforeEach(async () => {
    mockSessionService = {
      getRoles: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentFilterService,
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<DocumentFilterService>(DocumentFilterService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should set deleted flag and remove additional properties on docs without permissions in BulkGet', () => {
    const bulkGetResponse: BulkGetResponse = {
      results: [
        {
          id: 'Child:1',
          docs: [
            {
              ok: {
                _id: 'Child:1',
                _rev: 'someRev',
                _revisions: { start: 1, ids: ['someRev'] },
                someProperty: 'someValue',
              },
            },
          ],
        },
        {
          id: 'School:1',
          docs: [
            {
              ok: {
                _id: 'School:1',
                _rev: 'anotherRev',
                _revisions: { start: 1, ids: ['anotherRev'] },
                anotherProperty: 'anotherValue',
              },
            },
          ],
        },
      ],
    };
    service.accessControlList = [{ entity: 'Child', roles: ['admin'] }];
    jest.spyOn(mockSessionService, 'getRoles').mockReturnValue(['user']);

    const result = service.transformBulkGetResponse(bulkGetResponse);

    expect(result).toEqual({
      results: [
        {
          id: 'Child:1',
          docs: [
            {
              ok: {
                _id: 'Child:1',
                _rev: 'someRev',
                _revisions: { start: 1, ids: ['someRev'] },
                _deleted: true,
              },
            },
          ],
        },
        {
          id: 'School:1',
          docs: [
            {
              ok: {
                _id: 'School:1',
                _rev: 'anotherRev',
                _revisions: { start: 1, ids: ['anotherRev'] },
                anotherProperty: 'anotherValue',
              },
            },
          ],
        },
      ],
    });
  });

  it('should set deleted flag and remove additional properties on docs without permissions in AllDocs', () => {
    const allDocsResponse: AllDocsResponse = {
      total_rows: 2,
      offset: 0,
      rows: [
        {
          id: 'Child:1',
          key: 'someKey',
          value: { rev: 'someRev' },
          doc: {
            _id: 'Child:1',
            _rev: 'someRev',
            _revisions: { start: 1, ids: ['someRev'] },
            someProperty: 'someValue',
          },
        },
        {
          id: 'School:1',
          key: 'anotherKey',
          value: { rev: 'anotherRev' },
          doc: {
            _id: 'School:1',
            _rev: 'anotherRev',
            _revisions: { start: 1, ids: ['anotherRev'] },
            anotherProperty: 'anotherValue',
          },
        },
      ],
    };
    service.accessControlList = [{ entity: 'School', roles: ['admin'] }];
    jest.spyOn(mockSessionService, 'getRoles').mockReturnValue(['user']);

    const result = service.transformAllDocsResponse(allDocsResponse);

    expect(result).toEqual({
      total_rows: 2,
      offset: 0,
      rows: [
        {
          id: 'Child:1',
          key: 'someKey',
          value: { rev: 'someRev' },
          doc: {
            _id: 'Child:1',
            _rev: 'someRev',
            _revisions: { start: 1, ids: ['someRev'] },
            someProperty: 'someValue',
          },
        },
        {
          id: 'School:1',
          key: 'anotherKey',
          value: { rev: 'anotherRev' },
          doc: {
            _id: 'School:1',
            _rev: 'anotherRev',
            _revisions: { start: 1, ids: ['anotherRev'] },
            _deleted: true,
          },
        },
      ],
    });
  });

  it('should filter documents in BulkDocs request', () => {
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
    service.accessControlList = [{ entity: 'School', roles: ['admin'] }];
    jest.spyOn(mockSessionService, 'getRoles').mockReturnValue(['user']);

    const result = service.filterBulkDocsRequest(request);

    expect(result).toEqual({
      new_edits: false,
      docs: [
        {
          _id: 'Child:1',
          _rev: 'someRev',
          _revisions: { start: 1, ids: ['someRev'] },
          someProperty: 'someValue',
        },
      ],
    });
  });
});
