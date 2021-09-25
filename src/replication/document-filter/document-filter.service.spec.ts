import { Test, TestingModule } from '@nestjs/testing';
import { DocumentFilterService } from './document-filter.service';
import { BulkGetResponse } from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';
import { PermissionService } from '../permission/permission.service';
import { RulesService } from '../rules/rules.service';

describe('DocumentFilterService', () => {
  let service: DocumentFilterService;
  let normalUser: User;
  let adminUser: User;
  let schoolDoc: DatabaseDocument;
  let childDoc: DatabaseDocument;
  let mockRulesService: RulesService;

  beforeEach(async () => {
    mockRulesService = {
      getRulesForUser: () => undefined,
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentFilterService,
        PermissionService,
        { provide: RulesService, useValue: mockRulesService },
      ],
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

  it('should filter out docs without read permissions in BulkGet', () => {
    const bulkGetResponse = createBulkGetResponse(schoolDoc, childDoc);
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'write', subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result).toEqual(createBulkGetResponse(schoolDoc));
  });

  it('should not filter out deleted documents in bulk get', () => {
    const bulkGetResponse = createBulkGetResponse(childDoc, schoolDoc);
    childDoc._deleted = true;
    schoolDoc._deleted = true;
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: 'write', subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);

    const result = service.filterBulkGetResponse(bulkGetResponse, normalUser);

    expect(result).toEqual(bulkGetResponse);
  });

  it('should filter out docs without read permissions in AllDocs', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc, childDoc);
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'Child' }]);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(childDoc));
  });

  it('should not filter out deleted docs in AllDocs', () => {
    const allDocsResponse = createAllDocsResponse(schoolDoc, childDoc);
    schoolDoc._deleted = true;
    childDoc._deleted = true;
    jest
      .spyOn(mockRulesService, 'getRulesForUser')
      .mockReturnValue([{ action: 'manage', subject: 'Child' }]);

    const result = service.filterAllDocsResponse(allDocsResponse, normalUser);

    expect(result).toEqual(createAllDocsResponse(schoolDoc, childDoc));
  });

  it('should filter documents in BulkDocs request', () => {
    const request: BulkDocsRequest = {
      new_edits: false,
      docs: [childDoc, schoolDoc],
    };
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([
      { action: ['read', 'write'], subject: 'Child' },
      { action: 'read', subject: 'School' },
    ]);

    const result = service.filterBulkDocsRequest(request, normalUser);

    expect(result).toEqual({
      new_edits: false,
      docs: [childDoc],
    });
  });

  function createBulkGetResponse(
    ...documents: DatabaseDocument[]
  ): BulkGetResponse {
    return {
      results: documents.map((doc) => ({
        id: doc._id,
        docs: [{ ok: doc }],
      })),
    };
  }

  function createAllDocsResponse(
    ...documents: DatabaseDocument[]
  ): AllDocsResponse {
    return {
      total_rows: 10,
      offset: 0,
      rows: documents.map((doc) => ({
        id: doc._id,
        key: 'key-' + doc._id,
        value: { rev: schoolDoc._rev },
        doc: doc,
      })),
    };
  }
});
