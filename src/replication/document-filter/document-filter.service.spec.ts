import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';

describe('DocumentFilterService', () => {
  let service: DocumentFilterService;
  let normalUser: User;
  let adminUser: User;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DocumentFilterService],
    }).compile();

    service = module.get<DocumentFilterService>(DocumentFilterService);
    normalUser = new User('normalUser', ['user']);
    adminUser = new User('adminUser', ['admin']);

    schoolDoc = {
      _id: 'School:1',
      _rev: 'anotherRev',
      _revisions: { start: 1, ids: ['anotherRev'] },
      anotherProperty: 'anotherValue',
    };
    childDoc = {
      _id: 'Child:1',
      _rev: 'someRev',
      _revisions: { start: 1, ids: ['someRev'] },
      someProperty: 'someValue',
    };
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should filter out docs without permissions in BulkGet', () => {
    const bulkGetResponse: BulkGetResponse = {
      results: [
        {
          id: childDoc._id,
          docs: [{ ok: childDoc }],
        },
        {
          id: schoolDoc._id,
          docs: [{ ok: schoolDoc }],
        },
      ],
    };
    service.accessControlList = [{ entity: 'Child', roles: ['admin'] }];

    const result = service.transformBulkGetResponse(
      bulkGetResponse,
      normalUser,
    );

    expect(result).toEqual({
      results: [
        {
          id: schoolDoc._id,
          docs: [{ ok: schoolDoc }],
        },
      ],
    });
  });

  it('should filter out docs without permissions in AllDocs', () => {
    const allDocsResponse: AllDocsResponse = {
      total_rows: 2,
      offset: 0,
      rows: [
        {
          id: childDoc._id,
          key: 'someKey',
          value: { rev: childDoc._rev },
          doc: childDoc,
        },
        {
          id: schoolDoc._id,
          key: 'anotherKey',
          value: { rev: schoolDoc._rev },
          doc: schoolDoc,
        },
      ],
    };
    service.accessControlList = [{ entity: 'School', roles: ['admin'] }];

    const result = service.transformAllDocsResponse(
      allDocsResponse,
      normalUser,
    );

    expect(result).toEqual({
      total_rows: 2,
      offset: 0,
      rows: [
        {
          id: childDoc._id,
          key: 'someKey',
          value: { rev: childDoc._rev },
          doc: childDoc,
        },
      ],
    });
  });

  it('should filter documents in BulkDocs request', () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [childDoc, schoolDoc],
    };
    service.accessControlList = [{ entity: 'School', roles: ['admin'] }];

    const result = service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: false,
      docs: [childDoc],
    });
  });
});
