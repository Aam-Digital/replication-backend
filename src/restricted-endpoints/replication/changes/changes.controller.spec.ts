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
} from '../bulk-document/couchdb-dtos/changes.dto';
import { ChangesController } from './changes.controller';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { ConfigService } from '@nestjs/config';

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
        DocumentFilterService,
        { provide: ConfigService, useValue: { get: () => undefined } },
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
      limit: 2500,
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
    expect(res.lostPermissions).toEqual([schoolDoc._id]);
  });

  it('should populate lostPermissions with all permission-denied non-deleted docs', async () => {
    // No permissions at all
    getRulesSpy.mockReturnValue([]);

    const res = await controller.changes('some-db', user);

    expect(res.lostPermissions).toEqual([
      schoolDoc._id,
      privateSchoolDoc._id,
      childDoc._id,
    ]);
  });

  it('should not include clean deletion tombstones in lostPermissions (they are forwarded via permitted changes)', async () => {
    getRulesSpy.mockReturnValue([]);

    const res = await controller.changes('some-db', user);

    // Clean tombstones (_id, _rev, _deleted only) go into permitted results so
    // PouchDB handles the deletion natively - no need to also purge via lostPermissions.
    expect(res.lostPermissions).not.toContain(deletedChildDoc._id);
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
    expect(res.lostPermissions).toContain(deletedWithProps._id);
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
    expect(res.lostPermissions).not.toContain(docCurrentlyReadable._id);
  });

  it('should accumulate lostPermissions across paginated requests', async () => {
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    getSpy
      .mockReturnValueOnce(createChanges([schoolDoc, privateSchoolDoc], 2))
      .mockReturnValueOnce(createChanges([childDoc, deletedChildDoc]));

    const res = await controller.changes('some-db', user, { limit: 2 });

    expect(res.lostPermissions).toEqual([schoolDoc._id, privateSchoolDoc._id]);
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

  it('should only include lostPermissions within limit or trailing the permitted limit', async () => {
    // Scenario: CouchDB returns [permitted, permitted, lost, permitted(overflow), lost]
    // With limit=2, the first 2 permitted results are included.
    // The lost entry (schoolDoc) between them and the next overflow permitted result
    // IS included because lostPermissions don't count toward the limit.
    // schoolDoc2 (after the overflow) is NOT included because scanning stops at the overflow.
    const childDoc2: DatabaseDocument = { _id: 'Child:2' };
    const schoolDoc2: DatabaseDocument = { _id: 'School:3' };
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    getSpy.mockReturnValueOnce(
      createChanges([childDoc, childDoc2, schoolDoc, childDoc, schoolDoc2], 0),
    );

    const res = await controller.changes('some-db', user, { limit: 2 });

    expect(res.results.map((r) => r.id)).toEqual([childDoc._id, childDoc2._id]);
    // schoolDoc comes after the 2nd permitted result but before the overflow,
    // so it IS included in lostPermissions for this page
    expect(res.lostPermissions).toEqual([schoolDoc._id]);
    // The overflow permitted result (childDoc) + schoolDoc2 are unprocessed
    expect(res.pending).toBe(2);
    expect(res.last_seq).toBe(docToChange(schoolDoc).seq);
  });

  it('should include lostPermissions that precede the last included result when limit is hit', async () => {
    // Scenario: CouchDB returns [permitted, lost, permitted, permitted(overflow)]
    // With limit=2, the lost entry (between the two included permitted results)
    // should be in lostPermissions because it falls within the page boundary.
    const childDoc2: DatabaseDocument = { _id: 'Child:2' };
    getRulesSpy.mockReturnValue([{ subject: 'Child', action: 'read' }]);
    getSpy.mockReturnValueOnce(
      createChanges([childDoc, schoolDoc, childDoc2, childDoc], 0),
    );

    const res = await controller.changes('some-db', user, { limit: 2 });

    expect(res.results.map((r) => r.id)).toEqual([childDoc._id, childDoc2._id]);
    // schoolDoc comes BEFORE the 2nd permitted result, so it IS included
    expect(res.lostPermissions).toEqual([schoolDoc._id]);
    expect(res.pending).toBe(1);
    expect(res.last_seq).toBe(docToChange(childDoc2).seq);
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
    expect(res.lostPermissions).toEqual([schoolDoc._id, childDoc._id]);
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

  it('should silently skip _design/ documents without adding them to results or lostPermissions', async () => {
    const designDoc: DatabaseDocument = { _id: '_design/some-view' };
    getRulesSpy.mockReturnValue([{ subject: 'all', action: 'manage' }]);
    getSpy.mockReturnValue(createChanges([schoolDoc, designDoc, childDoc]));

    const res = await controller.changes('some-db', user);

    expect(res.results.map((r) => r.id)).toEqual([
      schoolDoc._id,
      childDoc._id,
    ]);
    expect(res.lostPermissions).toEqual([]);
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
