import { of, throwError } from 'rxjs';
import { DocumentWriteService } from './document-write.service';
import { UserInfo } from '../session/user-auth.dto';
import {
  detectDocumentType,
  DocumentAbility,
} from '../../permissions/permission/permission.service';

const user = new UserInfo('user-id', 'User:1', ['admin']);

function makeService(opts?: {
  existingDoc?: any;
  ability?: DocumentAbility;
}) {
  const couchdb = {
    get: jest
      .fn()
      .mockReturnValue(
        opts?.existingDoc
          ? of(opts.existingDoc)
          : throwError(() => new Error('not found')),
      ),
    put: jest.fn().mockReturnValue(of({ ok: true, id: 'x', rev: '2-new' })),
    delete: jest.fn().mockReturnValue(of({ ok: true, id: 'x', rev: '2-del' })),
  };
  const permission = {
    isAllowedTo: jest.fn(async () => true),
    getAbilityFor: () =>
      opts?.ability ??
      new DocumentAbility([{ subject: 'all', action: 'manage' }], {
        detectSubjectType: detectDocumentType,
      }),
  };
  const audit = { record: jest.fn() };
  const service = new DocumentWriteService(
    couchdb as any,
    permission as any,
    audit as any,
  );
  return { service, couchdb, permission, audit };
}

it('records a create when the document does not exist yet', async () => {
  const { service, audit } = makeService();
  const doc = { _id: 'Child:1', name: 'A' };

  await service.putDocument('app', 'Child:1', doc, user);

  expect(audit.record).toHaveBeenCalledTimes(1);
  const [db, entries, recordedUser] = audit.record.mock.calls[0];
  expect(db).toBe('app');
  expect(recordedUser).toBe(user);
  expect(entries[0].operation).toBe('create');
  expect(entries[0].newRev).toBe('2-new');
});

it('records an update with the deep-cloned before-state (pre-mutation)', async () => {
  const ability = new DocumentAbility(
    [{ subject: 'Child', action: ['read', 'update'], fields: ['name'] }],
    { detectSubjectType: detectDocumentType },
  );
  const existingDoc = { _id: 'Child:1', _rev: '1-a', name: 'A' };
  const { service, audit } = makeService({ existingDoc, ability });

  await service.putDocument('app', 'Child:1', { _id: 'Child:1', name: 'B' }, user);

  const entry = audit.record.mock.calls[0][1][0];
  expect(entry.operation).toBe('update');
  // before-state retains the original value although applyPermissions mutated
  // the existing doc in place into the final written doc
  expect(entry.existingDoc.name).toBe('A');
  expect(entry.newDoc.name).toBe('B');
});

it('records a delete with the _deleted after-state', async () => {
  const existingDoc = { _id: 'Child:1', _rev: '1-a', name: 'A' };
  const { service, audit } = makeService({ existingDoc });

  await service.deleteDocument('app', 'Child:1', user, { rev: '1-a' });

  const entry = audit.record.mock.calls[0][1][0];
  expect(entry.operation).toBe('delete');
  expect(entry.newDoc._deleted).toBe(true);
  expect(entry.newRev).toBe('2-del');
});

it('does not write or audit when create permission is missing', async () => {
  const { service, couchdb, permission, audit } = makeService();
  permission.isAllowedTo = jest.fn(async () => false);

  await expect(
    service.putDocument('app', 'Child:1', { _id: 'Child:1' }, user),
  ).rejects.toThrow();
  expect(couchdb.put).not.toHaveBeenCalled();
  expect(audit.record).not.toHaveBeenCalled();
});
