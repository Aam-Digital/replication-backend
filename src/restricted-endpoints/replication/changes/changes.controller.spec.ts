import { Test, TestingModule } from '@nestjs/testing';
import { Observable, of } from 'rxjs';
import { authGuardMockProviders } from '../../../auth/auth-guard-mock.providers';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { RulesService } from '../../../permissions/rules/rules.service';
import { UserInfo } from '../../session/user-auth.dto';
import { DatabaseDocument } from '../bulk-document/couchdb-dtos/bulk-docs.dto';
import {
  ChangeResult,
  ChangesResponse,
  LostPermissionsEntry,
} from '../bulk-document/couchdb-dtos/changes.dto';
import { ChangesController } from './changes.controller';

describe('ChangesController', () => {
  let controller: ChangesController;
  const schoolDoc: DatabaseDocument = { _id: 'School:1' };
  const privateSchoolDoc: DatabaseDocument = { _id: 'School:2', private: true };
  const childDoc: DatabaseDocument = { _id: 'Child:1' };
  const deletedChildDoc: DatabaseDocument = { _id: 'Child:2', _deleted: true };
  const changes = createChanges([
    schoolDoc,
    privateSchoolDoc,
    childDoc,
    deletedChildDoc,
  ]);
  const user: UserInfo = {
    id: 'user-id',
    name: 'username',
    roles: [],
    projects: [],
  };
  const mockCouchdbService = { get: () => undefined } as CouchdbService;
  const getSpy = jest.spyOn(mockCouchdbService, 'get');
  const mockRulesService = {
    getRulesForUser: () => undefined,
  } as any as RulesService;
  const getRulesSpy = jest.spyOn(mockRulesService, 'getRulesForUser');

  beforeEach(async () => {
    getSpy.mockReset();
    getRulesSpy.mockReset();
    jest.spyOn(mockCouchdbService, 'get').mockReturnValue(changes);
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
    const expectedLost: LostPermissionsEntry[] = [
      { _id: schoolDoc._id, _rev: docToChange(schoolDoc).doc._rev },
    ];
    expect(res.lostPermissions).toEqual(expectedLost);
  });

  it('should populate lostPermissions with all permission-denied non-deleted docs', async () => {
    // No permissions at all
    getRulesSpy.mockReturnValue([]);

    const res = await controller.changes('some-db', user);

    const expectedLost: LostPermissionsEntry[] = [
      schoolDoc,
      privateSchoolDoc,
      childDoc,
    ].map((doc) => ({ _id: doc._id, _rev: docToChange(doc).doc._rev }));
    expect(res.lostPermissions).toEqual(expectedLost);
  });

  it('should not include clean deletion tombstones in lostPermissions (they are forwarded via permitted changes)', async () => {
    getRulesSpy.mockReturnValue([]);

    const res = await controller.changes('some-db', user);

    // Clean tombstones (_id, _rev, _deleted only) go into permitted results so
    // PouchDB handles the deletion natively - no need to also purge via lostPermissions.
    expect(res.lostPermissions.map((e) => e._id)).not.toContain(
      deletedChildDoc._id,
    );
  });

  it('should include deleted docs with extra properties in lostPermissions if user cannot read them', async () => {
    const deletedWithProps: DatabaseDocument = {
      _id: 'School:deletedWith',
      _rev: '1-rev-with',
      _deleted: true,
      private: true,
    };
    getSpy.mockReturnValue(createChanges([deletedWithProps]));
    // No read permission for School
    getRulesSpy.mockReturnValue([]);

    const res = await controller.changes('some-db', user);

    // Not forwarded as a permitted change (has extra props, no read permission)
    expect(res.results.map((r) => r.id)).not.toContain(deletedWithProps._id);
    // But client still needs to purge any local copy
    expect(res.lostPermissions).toContainEqual({
      _id: deletedWithProps._id,
      _rev: docToChange(deletedWithProps).doc._rev,
    });
  });

  it('should not add doc to lostPermissions if user has access to the latest revision (even if a previous revision had lost permissions)', async () => {
    // CouchDB _changes only returns the latest revision per doc.
    // If a doc lost permissions at rev 4 but regained them at rev 5,
    // the server only sees rev 5 (readable) - no purge signal should be sent.
    const docCurrentlyReadable: DatabaseDocument = {
      _id: 'School:regained',
      someField: 'value',
    };
    getSpy.mockReturnValue(createChanges([docCurrentlyReadable]));
    getRulesSpy.mockReturnValue([{ subject: 'School', action: 'read' }]);

    const res = await controller.changes('some-db', user);

    expect(res.results.map((r) => r.id)).toContain(docCurrentlyReadable._id);
    expect(res.lostPermissions.map((e) => e._id)).not.toContain(
      docCurrentlyReadable._id,
    );
  });

  it('should accumulate lostPermissions across paginated requests', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    getSpy
      .mockReturnValueOnce(createChanges([schoolDoc, privateSchoolDoc], 2))
      .mockReturnValueOnce(createChanges([childDoc, deletedChildDoc]));

    const res = await controller.changes('some-db', user, { limit: 2 });

    const expectedLost: LostPermissionsEntry[] = [
      schoolDoc,
      privateSchoolDoc,
    ].map((doc) => ({ _id: doc._id, _rev: docToChange(doc).doc._rev }));
    expect(res.lostPermissions).toEqual(expectedLost);
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
    getSpy
      .mockReturnValueOnce(createChanges([schoolDoc, privateSchoolDoc], 2))
      .mockReturnValueOnce(createChanges([childDoc, deletedChildDoc]));

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
    getSpy
      .mockReturnValueOnce(createChanges([schoolDoc, childDoc, childDoc], 3))
      .mockReturnValueOnce(createChanges([schoolDoc, childDoc, childDoc]));

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

  it('should return last sequence number if no more matching changes were found', async () => {
    // Not allowed to read anything
    getRulesSpy.mockReturnValue([]);
    getSpy.mockReturnValueOnce(createChanges([schoolDoc, childDoc], 0));

    const lastSeq = docToChange(childDoc).seq;

    const res = await controller.changes('some-db', user, { limit: 3 });

    expect(res.pending).toBe(0);
    expect(res.last_seq).toBe(lastSeq);
    expect(res.results).toEqual([]);
    expect(res.lostPermissions).toEqual([
      { _id: schoolDoc._id, _rev: docToChange(schoolDoc).doc._rev },
      { _id: childDoc._id, _rev: docToChange(childDoc).doc._rev },
    ]);
  });

  it('should not return docs of deleted documents that still have other properties', async () => {
    const deletedWithoutProps: DatabaseDocument = {
      _id: 'School:deletedWithout',
      _rev: '1-rev-without',
      _deleted: true,
    };
    const deletedWithProps: DatabaseDocument = {
      _id: 'School:deletedWith',
      _rev: '1-rev-with',
      _deleted: true,
      private: true,
    };
    getSpy.mockReturnValue(
      createChanges([deletedWithProps, deletedWithoutProps]),
    );

    const res = await controller.changes('some-db', user, {
      include_docs: 'true',
    });

    expect(res.results).toEqual([docToChange(deletedWithoutProps)]);
  });

  function createChanges(
    docs: DatabaseDocument[],
    pending = 0,
  ): Observable<ChangesResponse> {
    return of({
      pending,
      last_seq: docToChange(docs[docs.length - 1]).seq,
      results: docs.map(docToChange),
    });
  }

  function docToChange(doc: DatabaseDocument): ChangeResult {
    return {
      doc: { ...doc, _rev: `1-rev-${doc._id}` },
      id: doc._id,
      changes: [{ rev: `rev-${doc._id}` }],
      seq: `seq-${doc._id}`,
    };
  }
});
