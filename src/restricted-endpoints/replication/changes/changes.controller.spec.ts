import { Test, TestingModule } from '@nestjs/testing';
import { ChangesController } from './changes.controller';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';
import {
  ChangeResult,
  ChangesResponse,
} from '../bulk-document/couchdb-dtos/changes.dto';
import { DatabaseDocument } from '../bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import { firstValueFrom, of } from 'rxjs';
import {
  DocumentRule,
  RulesService,
} from '../../../permissions/rules/rules.service';

describe('ChangesController', () => {
  let controller: ChangesController;
  let mockCouchdbService: CouchdbService;
  let mockRulesService: RulesService;
  const schoolDoc: DatabaseDocument = { _id: 'School:1' };
  const privateSchoolDoc: DatabaseDocument = { _id: 'School:2', private: true };
  const childDoc: DatabaseDocument = { _id: 'Child:1' };
  const deletedChildDoc: DatabaseDocument = { _id: 'Child:2', _deleted: true };
  const changes: ChangesResponse = {
    last_seq: 'some_seq',
    results: [schoolDoc, privateSchoolDoc, childDoc, deletedChildDoc].map(
      docToChange,
    ),
  };
  const user: UserInfo = { name: 'username', roles: [] };

  function docToChange(doc: DatabaseDocument): ChangeResult {
    return {
      doc,
      id: doc._id,
      changes: [{ rev: `rev-${doc._id}` }],
      seq: `seq-${doc._id}`,
    };
  }

  beforeEach(async () => {
    mockCouchdbService = { get: () => undefined } as any;
    mockRulesService = { getRulesForUser: () => undefined } as any;
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChangesController],
      providers: [
        ...authGuardMockProviders,
        { provide: CouchdbService, useValue: mockCouchdbService },
        { provide: RulesService, useValue: mockRulesService },
        PermissionService,
      ],
    }).compile();

    controller = module.get<ChangesController>(ChangesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should use the rules of the requesting user', () => {
    getChangesResults([]);

    expect(mockRulesService.getRulesForUser).toHaveBeenCalledWith(user);
  });

  it('should forward params', () => {
    const params = { since: 'now', feed: 'continuous', limit: '500' };
    getChangesResults([], params);

    expect(mockCouchdbService.get).toHaveBeenCalledWith('some-db', '_changes', {
      ...params,
      include_docs: true,
    });
  });

  it('should return all changes if user is allowed to read everything', async () => {
    const res = await getChangesResults([{ subject: 'all', action: 'manage' }]);

    expect(res.results.map((r) => r.id)).toEqual([
      schoolDoc._id,
      privateSchoolDoc._id,
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should filter out changes for which the user does not have access', async () => {
    const res = await getChangesResults([
      { subject: 'School', action: 'read', conditions: { private: true } },
      { subject: 'Child', action: 'manage' },
    ]);

    expect(res.results.map((r) => r.id)).toEqual([
      privateSchoolDoc._id,
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should always return deleted docs', async () => {
    const res = await getChangesResults([
      { subject: 'School', action: 'read' },
    ]);

    expect(res.results.map((r) => r.id)).toEqual([
      schoolDoc._id,
      privateSchoolDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should not return the document content', async () => {
    const res = await getChangesResults([
      { subject: 'School', action: 'read' },
    ]);

    res.results.forEach((r) => expect(r.doc).toBeUndefined());
  });

  function getChangesResults(rules: DocumentRule[], params?) {
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue(rules);
    jest.spyOn(mockCouchdbService, 'get').mockReturnValue(of({ ...changes }));

    return firstValueFrom(controller.changes('some-db', params, user));
  }
});
