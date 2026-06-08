import { of } from 'rxjs';
import { AuditService } from './audit.service';
import { UserInfo } from '../restricted-endpoints/session/user-auth.dto';
import { AuditEntry } from './audit-record.dto';

function makeService(opts?: { enabled?: boolean; existingAuditRows?: any[] }) {
  const couchdb = {
    createDb: jest.fn().mockReturnValue(of({ ok: true })),
    get: jest.fn().mockReturnValue(of({ rows: opts?.existingAuditRows ?? [] })),
    post: jest.fn().mockReturnValue(of({})),
  };
  const config = {
    get: () => (opts?.enabled === false ? 'false' : 'true'),
  };
  const service = new AuditService(couchdb as any, config as any);
  return { service, couchdb };
}

const user = new UserInfo('keycloak-id', 'User:1', ['admin']);

function postedRecords(couchdb: any) {
  return couchdb.post.mock.calls[0][2].docs;
}

it('is a no-op when the feature is disabled', async () => {
  const { service, couchdb } = makeService({ enabled: false });

  await service.record(
    'app',
    [{ newDoc: { _id: 'Child:1', _rev: '1-a' }, operation: 'create' }],
    user,
  );

  expect(couchdb.post).not.toHaveBeenCalled();
});

it('writes one create record with server timestamp and authenticated user', async () => {
  const { service, couchdb } = makeService();
  const entry: AuditEntry = {
    newDoc: { _id: 'Child:1', _rev: '1-abcd', name: 'A' },
    operation: 'create',
  };

  await service.record('app', [entry], user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(1);
  expect(records[0].entityId).toBe('Child:1');
  expect(records[0].database).toBe('app');
  expect(records[0].operation).toBe('create');
  expect(records[0].rev).toBe('1-abcd');
  expect(records[0].user).toEqual({
    id: 'keycloak-id',
    name: 'User:1',
    roles: ['admin'],
  });
  expect(records[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  expect(records[0]._id).toBe(
    `AuditRecord:Child:1:${records[0].timestamp}:1-abcd`,
  );
  // _id prefix makes the proxy classify this as subject `AuditRecord`
  expect(records[0]._id.split(':')[0]).toBe('AuditRecord');
  expect(records[0].diff).toBeDefined();
  expect(couchdb.post).toHaveBeenCalledWith('app-audit', '_bulk_docs', {
    docs: records,
  });
});

it('keeps _updatedAt/_updatedBy and excludes _rev/_revisions in the diff', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'x' }],
  });
  const entry: AuditEntry = {
    existingDoc: {
      _id: 'Child:1',
      _rev: '1-a',
      name: 'A',
      _updatedAt: 't1',
      _updatedBy: 'u1',
    },
    newDoc: {
      _id: 'Child:1',
      _rev: '2-b',
      name: 'B',
      _updatedAt: 't2',
      _updatedBy: 'u2',
      _revisions: { start: 2, ids: ['b', 'a'] },
    },
    operation: 'update',
  };

  await service.record('app', [entry], user);

  const record = postedRecords(couchdb)[0];
  expect(record.operation).toBe('update');
  expect(record.diff.name).toBeDefined();
  expect(record.diff._updatedAt).toBeDefined();
  expect(record.diff._updatedBy).toBeDefined();
  expect(record.diff._rev).toBeUndefined();
  expect(record.diff._revisions).toBeUndefined();
  expect(record.parentRev).toBe('1-a');
});

it('writes a baseline snapshot on the first change to a previously-unaudited entity', async () => {
  const { service, couchdb } = makeService({ existingAuditRows: [] });
  const entry: AuditEntry = {
    existingDoc: { _id: 'Child:1', _rev: '1-a', name: 'A' },
    newDoc: { _id: 'Child:1', _rev: '2-b', name: 'B' },
    operation: 'update',
  };

  await service.record('app', [entry], user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(2);
  expect(records[0].operation).toBe('baseline');
  expect(records[0].diff).toEqual({ _id: 'Child:1', name: 'A' });
  expect(records[1].operation).toBe('update');
});

it('does not write a baseline when the entity already has an audit record', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'AuditRecord:Child:1:...' }],
  });
  const entry: AuditEntry = {
    existingDoc: { _id: 'Child:1', _rev: '1-a', name: 'A' },
    newDoc: { _id: 'Child:1', _rev: '2-b', name: 'B' },
    operation: 'update',
  };

  await service.record('app', [entry], user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(1);
  expect(records[0].operation).toBe('update');
});

it('records a delete operation', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'x' }],
  });
  const entry: AuditEntry = {
    existingDoc: { _id: 'Child:1', _rev: '1-a', name: 'A' },
    newDoc: { _id: 'Child:1', _rev: '2-b', _deleted: true },
    operation: 'delete',
  };

  await service.record('app', [entry], user);

  expect(postedRecords(couchdb)[0].operation).toBe('delete');
});

it('skips non-replicable documents (_design/, _local/)', async () => {
  const { service, couchdb } = makeService();

  await service.record(
    'app',
    [
      { newDoc: { _id: '_design/views', _rev: '1-a' }, operation: 'update' },
      { newDoc: { _id: '_local/abc', _rev: '1-a' }, operation: 'update' },
    ],
    user,
  );

  expect(couchdb.post).not.toHaveBeenCalled();
});

it('never audits the audit database itself', async () => {
  const { service, couchdb } = makeService();

  await service.record(
    'app-audit',
    [{ newDoc: { _id: 'Child:1', _rev: '1-a' }, operation: 'create' }],
    user,
  );

  expect(couchdb.post).not.toHaveBeenCalled();
});

it('does not throw when the audit write fails (best-effort)', async () => {
  const { service, couchdb } = makeService();
  couchdb.post.mockImplementation(() => {
    throw new Error('couch down');
  });

  await expect(
    service.record(
      'app',
      [{ newDoc: { _id: 'Child:1', _rev: '1-a' }, operation: 'create' }],
      user,
    ),
  ).resolves.toBeUndefined();
});
