import { of } from 'rxjs';
import { AuditService, DefaultAuditService } from './audit.service';
import { NoopAuditService } from './noop-audit.service';
import { UserInfo } from '../restricted-endpoints/session/user-auth.dto';
import { AuditEntry } from './audit-record.dto';

function makeService(opts?: { existingAuditRows?: any[] }) {
  const couchdb = {
    createDb: jest.fn().mockReturnValue(of({ ok: true })),
    get: jest.fn().mockReturnValue(of({ rows: opts?.existingAuditRows ?? [] })),
    post: jest.fn().mockReturnValue(of({})),
  };
  const service = new DefaultAuditService(couchdb as any);
  return { service, couchdb };
}

const user = new UserInfo('keycloak-id', 'User:1', ['admin']);

function postedRecords(couchdb: any) {
  return couchdb.post.mock.calls[0][2].docs;
}

it('NoopAuditService records nothing (wired when the feature is disabled)', async () => {
  const service: AuditService = new NoopAuditService();

  await expect(
    service.record(
      'app',
      [{ newDoc: { _id: 'Child:1', _rev: '1-a' }, operation: 'create' }],
      user,
    ),
  ).resolves.toBeUndefined();
  await expect(
    service.recordBulkWrite('app', { docs: [] } as any, new Map(), [], user),
  ).resolves.toBeUndefined();
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

it('keeps updated/created metadata and excludes _rev/_revisions in the diff', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'x' }],
  });
  const entry: AuditEntry = {
    existingDoc: {
      _id: 'Child:1',
      _rev: '1-a',
      name: 'A',
      created: { at: 't0', by: 'u0' },
      updated: { at: 't1', by: 'u1' },
    },
    newDoc: {
      _id: 'Child:1',
      _rev: '2-b',
      name: 'B',
      created: { at: 't0', by: 'u0' },
      updated: { at: 't2', by: 'u1' },
      _revisions: { start: 2, ids: ['b', 'a'] },
    },
    operation: 'update',
  };

  await service.record('app', [entry], user);

  const record = postedRecords(couchdb)[0];
  expect(record.operation).toBe('update');
  expect(record.diff.name).toBeDefined();
  // the changed `updated` metadata is kept in the diff (real entity field)
  expect(record.diff.updated).toBeDefined();
  // unchanged `created` produces no delta
  expect(record.diff.created).toBeUndefined();
  // internal CouchDB noise is excluded
  expect(record.diff._rev).toBeUndefined();
  expect(record.diff._revisions).toBeUndefined();
  expect(record.parentRev).toBe('1-a');
});

it('records the correct jsondiffpatch delta for an update', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'x' }],
  });
  const entry: AuditEntry = {
    existingDoc: { _id: 'Child:1', _rev: '1-a', name: 'A', status: 'active' },
    newDoc: { _id: 'Child:1', _rev: '2-b', name: 'B', status: 'active' },
    operation: 'update',
  };

  await service.record('app', [entry], user);

  const record = postedRecords(couchdb)[0];
  // jsondiffpatch delta: modified field is [oldValue, newValue]; unchanged
  // fields are omitted entirely
  expect(record.diff).toEqual({ name: ['A', 'B'] });
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

it('writes a baseline before the delete when the first audited operation is a delete (restore-from-delete)', async () => {
  const { service, couchdb } = makeService({ existingAuditRows: [] });
  const entry: AuditEntry = {
    existingDoc: { _id: 'Child:1', _rev: '1-a', name: 'A' },
    newDoc: { _id: 'Child:1', _rev: '2-b', _deleted: true },
    operation: 'delete',
  };

  await service.record('app', [entry], user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(2);
  // the baseline captures the full pre-delete snapshot so the entity can be
  // restored even though its first-ever audit record is the deletion
  expect(records[0].operation).toBe('baseline');
  expect(records[0].diff).toEqual({ _id: 'Child:1', name: 'A' });
  expect(records[1].operation).toBe('delete');
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

it('recordBulkWrite audits an update (new_edits:false, rev from body)', async () => {
  const { service, couchdb } = makeService({
    existingAuditRows: [{ id: 'x' }],
  });
  const existingDocs = new Map<string, any>([
    ['Child:1', { _id: 'Child:1', _rev: '1-a', name: 'A' }],
  ]);
  const written = {
    new_edits: false,
    docs: [{ _id: 'Child:1', _rev: '2-b', name: 'B' }],
  };
  // new_edits:false response lists only failures (none here)
  const response: any[] = [];

  await service.recordBulkWrite('app', written, existingDocs, response, user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(1);
  expect(records[0].operation).toBe('update');
  expect(records[0].rev).toBe('2-b');
  expect(records[0].diff).toEqual({ name: ['A', 'B'] });
});

it('recordBulkWrite takes the rev from the response on the new_edits:true path', async () => {
  const { service, couchdb } = makeService();
  const written = {
    new_edits: true,
    docs: [{ _id: 'Child:1', name: 'A' }],
  };
  // new_edits:true response carries {ok, id, rev} per doc
  const response = [{ ok: true, id: 'Child:1', rev: '5-server' }];

  await service.recordBulkWrite('app', written, new Map(), response, user);

  const records = postedRecords(couchdb);
  expect(records).toHaveLength(1);
  expect(records[0].operation).toBe('create');
  expect(records[0].rev).toBe('5-server');
});

it('recordBulkWrite skips conflicted/errored docs', async () => {
  const { service, couchdb } = makeService();
  const existingDocs = new Map<string, any>([
    ['Child:1', { _id: 'Child:1', _rev: '1-a', name: 'A' }],
  ]);
  const written = {
    new_edits: false,
    docs: [{ _id: 'Child:1', _rev: '2-b', name: 'B' }],
  };
  // doc reported as a conflict -> not audited
  const response = [{ id: 'Child:1', error: 'conflict', reason: 'x', rev: '' }];

  await service.recordBulkWrite('app', written, existingDocs, response, user);

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
