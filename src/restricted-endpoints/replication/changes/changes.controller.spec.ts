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
import { of } from 'rxjs';
import { RulesService } from '../../../permissions/rules/rules.service';

describe('ChangesController', () => {
  let controller: ChangesController;
  const schoolDoc: DatabaseDocument = { _id: 'School:1' };
  const privateSchoolDoc: DatabaseDocument = { _id: 'School:2', private: true };
  const childDoc: DatabaseDocument = { _id: 'Child:1' };
  const deletedChildDoc: DatabaseDocument = { _id: 'Child:2', _deleted: true };
  const changes: ChangesResponse = {
    last_seq: 'some_seq',
    results: [schoolDoc, privateSchoolDoc, childDoc, deletedChildDoc].map(
      docToChange,
    ),
    pending: 0,
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
  const mockCouchdbService = { get: () => undefined } as CouchdbService;
  const getSpy = jest.spyOn(mockCouchdbService, 'get');
  const mockRulesService = {
    getRulesForUser: () => undefined,
  } as any as RulesService;
  const getRulesSpy = jest.spyOn(mockRulesService, 'getRulesForUser');

  beforeEach(async () => {
    getSpy.mockReset();
    getRulesSpy.mockReset();
    jest.spyOn(mockCouchdbService, 'get').mockReturnValue(of({ ...changes }));
    jest.spyOn(mockRulesService, 'getRulesForUser').mockReturnValue([]);

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
    controller.changes('some-db', user);

    expect(mockRulesService.getRulesForUser).toHaveBeenCalledWith(user);
  });

  it('should forward params', () => {
    const params = { since: 'now', feed: 'continuous', limit: 500 };
    controller.changes('some-db', user, params);

    expect(mockCouchdbService.get).toHaveBeenCalledWith('some-db', '_changes', {
      ...params,
      include_docs: true,
    });
  });

  it('should return all changes if user is allowed to read everything', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'all', action: 'manage' }]);

    const res = await controller.changes('some-db', user);

    expect(res.results.map((r) => r.id)).toEqual([
      schoolDoc._id,
      privateSchoolDoc._id,
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should filter out changes for which the user does not have access', async () => {
    getRulesSpy.mockReturnValue([
      { subject: 'School', action: 'read', conditions: { private: true } },
      { subject: 'Child', action: 'manage' },
    ]);

    const res = await controller.changes('some-db', user);

    expect(res.results.map((r) => r.id)).toEqual([
      privateSchoolDoc._id,
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should always return deleted docs', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'School', action: 'read' }]);

    const res = await controller.changes('some-db', user);

    expect(res.results.map((r) => r.id)).toEqual([
      schoolDoc._id,
      privateSchoolDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should not return the document content on default', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'School', action: 'read' }]);

    const res = await controller.changes('some-db', user);

    res.results.forEach((r) => expect(r.doc).toBeUndefined());
  });

  it('should return the document content if requested', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'School', action: 'read' }]);

    const res = await controller.changes('some-db', user, {
      include_docs: 'true',
    });

    res.results.forEach((r) => expect(r.doc).toBeDefined());
  });

  it('should keep requesting docs until the limit is reached', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    const change1: ChangesResponse = {
      results: [schoolDoc, privateSchoolDoc].map(docToChange),
      pending: 2,
      last_seq: docToChange(privateSchoolDoc).seq,
    };
    const change2: ChangesResponse = {
      results: [childDoc, deletedChildDoc].map(docToChange),
      pending: 0,
      last_seq: docToChange(deletedChildDoc).seq,
    };
    getSpy.mockReturnValueOnce(of(change1)).mockReturnValueOnce(of(change2));

    const res = await controller.changes('some-db', user, { limit: 2 });

    expect(res.pending).toBe(0);
    expect(res.last_seq).toBe(docToChange(deletedChildDoc).seq);
    expect(res.results.map((r) => r.id)).toEqual([
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });

  it('should not return more changes than requested', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    const change: ChangesResponse = {
      results: [schoolDoc, childDoc, childDoc].map(docToChange),
      pending: 3,
      last_seq: docToChange(childDoc).seq,
    };
    getSpy
      .mockReturnValueOnce(of({ ...change }))
      .mockReturnValueOnce(of({ ...change, pending: 0 }));

    const res = await controller.changes('some-db', user, { limit: 3 });

    expect(res.pending).toBe(1);
    expect(res.last_seq).toBe(docToChange(childDoc).seq);
    res.results.forEach(({ id }) => expect(id).toBe(childDoc._id));
  });

  it('should only return remaining changes if not enough were found', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);

    const res = await controller.changes('some-db', user, { limit: 3 });

    expect(res.pending).toBe(0);
    expect(res.last_seq).toBe(docToChange(deletedChildDoc).seq);
    expect(res.results.map((r) => r.id)).toEqual([
      childDoc._id,
      deletedChildDoc._id,
    ]);
  });
});
