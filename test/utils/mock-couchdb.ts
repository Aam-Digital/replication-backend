import express from 'express';
import { Server } from 'http';
import { AddressInfo, Socket } from 'net';

/**
 * Minimal in-process CouchDB stand-in for e2e tests.
 *
 * Implements the subset of the CouchDB HTTP API used by the replication
 * backend (_session, _changes incl. longpoll, _all_docs, _bulk_get,
 * _bulk_docs, _find, _local_docs and single-document CRUD) backed by
 * simple in-memory maps.
 *
 * All incoming requests are recorded in {@link requests} so tests can make
 * assertions about what the backend sent upstream.
 */
export class MockCouchDb {
  private readonly app = express();
  private server?: Server;
  private readonly sockets = new Set<Socket>();

  /** username -> credentials/roles for the _session endpoint */
  readonly users = new Map<string, { password: string; roles: string[] }>();
  /** db name -> docId -> document */
  readonly dbs = new Map<string, Map<string, Record<string, unknown>>>();
  /** db name -> docId -> latest change seq */
  private readonly changeSeqs = new Map<string, Map<string, number>>();
  private readonly seqCounters = new Map<string, number>();

  /** held longpoll _changes requests, flushed by emitted changes */
  private readonly longpolls: {
    db: string;
    since: number;
    limit: number;
    includeDocs: boolean;
    res: express.Response;
    timer: NodeJS.Timeout;
  }[] = [];

  /** log of all received requests for test assertions */
  readonly requests: {
    method: string;
    url: string;
    body?: unknown;
    headers: Record<string, string | string[] | undefined>;
  }[] = [];

  /**
   * When set, the next _all_docs request receives a truncated JSON body and
   * an aborted connection — simulating CouchDB failing mid-response.
   */
  truncateNextAllDocs = false;

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`;
  }

  async start(): Promise<void> {
    this.setupRoutes();
    await new Promise<void>((resolve) => {
      this.server = this.app.listen(0, '127.0.0.1', () => resolve());
    });
    this.server!.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }

  async stop(): Promise<void> {
    for (const lp of this.longpolls) {
      clearTimeout(lp.timer);
    }
    this.longpolls.length = 0;
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      // force-close held sockets (e.g. pending longpolls)
      for (const socket of this.sockets) {
        socket.destroy();
      }
    });
  }

  /** Number of _session authentication requests received (for auth-caching assertions). */
  get sessionRequestCount(): number {
    return this.requests.filter((r) => r.url.startsWith('/_session')).length;
  }

  requestsFor(method: string, urlPrefix: string) {
    return this.requests.filter(
      (r) => r.method === method && r.url.startsWith(urlPrefix),
    );
  }

  clearRequestLog(): void {
    this.requests.length = 0;
  }

  // ---------------------------------------------------------------- seeding

  addUser(name: string, password: string, roles: string[]): void {
    this.users.set(name, { password, roles });
  }

  /**
   * Insert or update a document, assigning a new _rev and a change-feed entry.
   * Returns the stored doc.
   */
  putDoc(
    db: string,
    doc: Record<string, unknown>,
    opts: { deleted?: boolean } = {},
  ): Record<string, unknown> {
    const docs = this.getDb(db);
    const id = doc._id as string;
    const prev = docs.get(id);
    const prevRevNum = prev?._rev
      ? parseInt((prev._rev as string).split('-')[0], 10)
      : 0;
    const stored: Record<string, unknown> = {
      ...doc,
      _rev: `${prevRevNum + 1}-mock`,
    };
    if (opts.deleted) {
      stored._deleted = true;
    }
    docs.set(id, stored);
    if (!id.startsWith('_local/')) {
      this.recordChange(db, id);
    }
    this.flushLongpolls(db);
    return stored;
  }

  deleteDoc(db: string, id: string): void {
    const docs = this.getDb(db);
    const existing = docs.get(id);
    if (!existing) {
      return;
    }
    if (id.startsWith('_local/')) {
      docs.delete(id);
      return;
    }
    // keep a tombstone like CouchDB does: {_id, _rev, _deleted}
    const prevRevNum = parseInt((existing._rev as string).split('-')[0], 10);
    docs.set(id, {
      _id: id,
      _rev: `${prevRevNum + 1}-mock`,
      _deleted: true,
    });
    this.recordChange(db, id);
    this.flushLongpolls(db);
  }

  private getDb(db: string): Map<string, Record<string, unknown>> {
    if (!this.dbs.has(db)) {
      this.dbs.set(db, new Map());
      this.changeSeqs.set(db, new Map());
      this.seqCounters.set(db, 0);
    }
    return this.dbs.get(db)!;
  }

  private recordChange(db: string, id: string): void {
    const next = (this.seqCounters.get(db) ?? 0) + 1;
    this.seqCounters.set(db, next);
    this.getDb(db); // ensure maps exist
    this.changeSeqs.get(db)!.set(id, next);
  }

  // --------------------------------------------------------------- changes

  private changesSince(
    db: string,
    since: number,
    limit: number,
    includeDocs: boolean,
  ) {
    this.getDb(db);
    const all = [...this.changeSeqs.get(db)!.entries()]
      .filter(([, seq]) => seq > since)
      .sort((a, b) => a[1] - b[1]);
    const batch = all.slice(0, limit);
    const results = batch.map(([id, seq]) => {
      const doc = this.dbs.get(db)!.get(id)!;
      const result: Record<string, unknown> = {
        seq: `${seq}`,
        id,
        changes: [{ rev: doc._rev }],
      };
      if (doc._deleted) {
        result.deleted = true;
      }
      if (includeDocs) {
        result.doc = doc;
      }
      return result;
    });
    const lastSeq =
      batch.length > 0 ? batch[batch.length - 1][1] : this.seqCounters.get(db)!;
    return {
      results,
      last_seq: `${Math.max(lastSeq, since)}`,
      pending: all.length - batch.length,
    };
  }

  private parseSince(raw: unknown, db: string): number {
    if (raw === undefined || raw === '0' || raw === 0) {
      return 0;
    }
    if (raw === 'now') {
      return this.seqCounters.get(db) ?? 0;
    }
    return parseInt(String(raw), 10) || 0;
  }

  private flushLongpolls(db: string): void {
    for (let i = this.longpolls.length - 1; i >= 0; i--) {
      const lp = this.longpolls[i];
      if (lp.db !== db) {
        continue;
      }
      const response = this.changesSince(
        db,
        lp.since,
        lp.limit,
        lp.includeDocs,
      );
      if (response.results.length > 0) {
        clearTimeout(lp.timer);
        this.longpolls.splice(i, 1);
        lp.res.json(response);
      }
    }
  }

  // ---------------------------------------------------------------- routes

  private setupRoutes(): void {
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use((req, res, next) => {
      this.requests.push({
        method: req.method,
        url: req.url,
        body: req.body,
        headers: req.headers,
      });
      next();
    });

    this.app.get('/_session', (req, res) => {
      const auth = req.headers.authorization ?? '';
      if (!auth.startsWith('Basic ')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const [name, password] = Buffer.from(auth.slice(6), 'base64')
        .toString()
        .split(':');
      const user = this.users.get(name);
      if (!user || user.password !== password) {
        return res.status(401).json({
          error: 'unauthorized',
          reason: 'Name or password is incorrect.',
        });
      }
      res.json({ ok: true, userCtx: { name, roles: user.roles } });
    });

    this.app.get('/', (req, res) => {
      res.json({ couchdb: 'Welcome', version: 'mock' });
    });

    this.app.get('/:db/_changes', (req, res) => {
      const db = req.params.db;
      this.getDb(db);
      const since = this.parseSince(req.query.since, db);
      const includeDocs = req.query.include_docs === 'true';
      const limit = req.query.limit
        ? parseInt(String(req.query.limit), 10)
        : Infinity;

      if (req.query.feed === 'longpoll') {
        const immediate = this.changesSince(db, since, limit, includeDocs);
        if (immediate.results.length > 0) {
          return res.json(immediate);
        }
        const timeout = req.query.timeout
          ? parseInt(String(req.query.timeout), 10)
          : 60000;
        const entry = {
          db,
          since,
          limit,
          includeDocs,
          res,
          timer: setTimeout(() => {
            const idx = this.longpolls.indexOf(entry);
            if (idx >= 0) {
              this.longpolls.splice(idx, 1);
            }
            res.json(this.changesSince(db, since, limit, includeDocs));
          }, timeout),
        };
        this.longpolls.push(entry);
        res.on('close', () => {
          clearTimeout(entry.timer);
          const idx = this.longpolls.indexOf(entry);
          if (idx >= 0) {
            this.longpolls.splice(idx, 1);
          }
        });
        return;
      }

      res.json(this.changesSince(db, since, limit, includeDocs));
    });

    const allDocsHandler = (
      req: express.Request<{ db: string }>,
      res: express.Response,
    ) => {
      if (this.truncateNextAllDocs) {
        this.truncateNextAllDocs = false;
        res.setHeader('content-type', 'application/json');
        // flush a valid-looking first part of the response so the proxy
        // starts forwarding it, then cut the connection mid-body
        const rows = Array.from(
          { length: 50 },
          (_, i) => `{"id":"Child:${i}","key":"Child:${i}","value":{"rev":"1-mock"}}`,
        );
        res.write('{"total_rows":99,"offset":0,"rows":[' + rows.join(','));
        setTimeout(() => res.destroy(), 50);
        return;
      }
      const db = req.params.db;
      const docs = this.getDb(db);
      const includeDocs = req.query.include_docs === 'true';
      const keys: string[] | undefined = (req.body as { keys?: string[] })
        ?.keys;
      const ids =
        keys ?? [...docs.keys()].filter((k) => !k.startsWith('_local/')).sort();
      const rows = ids.map((id) => {
        const doc = docs.get(id);
        if (!doc) {
          return { key: id, error: 'not_found' };
        }
        const row: Record<string, unknown> = {
          id,
          key: id,
          value: { rev: doc._rev, ...(doc._deleted ? { deleted: true } : {}) },
        };
        if (includeDocs) {
          row.doc = doc._deleted ? null : doc;
        }
        return row;
      });
      res.json({ total_rows: docs.size, offset: 0, rows });
    };
    this.app.get('/:db/_all_docs', allDocsHandler);
    this.app.post('/:db/_all_docs', allDocsHandler);

    this.app.get('/:db/_local_docs', (req, res) => {
      const docs = this.getDb(req.params.db);
      const rows = [...docs.keys()]
        .filter((id) => id.startsWith('_local/'))
        .map((id) => ({ id, key: id, value: { rev: docs.get(id)!._rev } }));
      res.json({ total_rows: rows.length, offset: 0, rows });
    });

    this.app.post('/:db/_bulk_get', (req, res) => {
      const docs = this.getDb(req.params.db);
      const requested: { id: string; rev?: string }[] =
        (req.body as { docs?: { id: string }[] })?.docs ?? [];
      const results = requested.map(({ id }) => {
        const doc = docs.get(id);
        if (!doc) {
          return {
            id,
            docs: [
              {
                error: {
                  id,
                  rev: 'undefined',
                  error: 'not_found',
                  reason: 'missing',
                },
              },
            ],
          };
        }
        return { id, docs: [{ ok: doc }] };
      });
      res.json({ results });
    });

    this.app.post('/:db/_bulk_docs', (req, res) => {
      const db = req.params.db;
      const body = req.body as { docs: Record<string, unknown>[] };
      const result = (body?.docs ?? []).map((doc) => {
        const stored = this.putDoc(db, doc);
        return { ok: true, id: stored._id, rev: stored._rev };
      });
      res.status(201).json(result);
    });

    this.app.post('/:db/_find', (req, res) => {
      const docs = this.getDb(req.params.db);
      const selector =
        (req.body as { selector?: Record<string, unknown> })?.selector ?? {};
      const matches = [...docs.values()].filter(
        (doc) =>
          !doc._deleted &&
          Object.entries(selector).every(
            ([field, value]) => doc[field] === value,
          ),
      );
      res.json({ docs: matches, bookmark: 'mock-bookmark' });
    });

    this.app.post('/:db/_revs_diff', (req, res) => {
      res.json({});
    });

    this.app.get('/:db/_local/:id', (req, res) => {
      const doc = this.getDb(req.params.db).get(`_local/${req.params.id}`);
      if (!doc) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      res.json(doc);
    });

    this.app.put('/:db/_local/:id', (req, res) => {
      const stored = this.putDoc(req.params.db, {
        ...(req.body as Record<string, unknown>),
        _id: `_local/${req.params.id}`,
      });
      res.status(201).json({ ok: true, id: stored._id, rev: stored._rev });
    });

    this.app.delete('/:db/_local/:id', (req, res) => {
      const id = `_local/${req.params.id}`;
      if (!this.getDb(req.params.db).has(id)) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      this.deleteDoc(req.params.db, id);
      res.json({ ok: true, id, rev: '0-deleted' });
    });

    this.app.get('/:db', (req, res) => {
      const docs = this.getDb(req.params.db);
      res.json({
        db_name: req.params.db,
        doc_count: docs.size,
        update_seq: `${this.seqCounters.get(req.params.db) ?? 0}`,
      });
    });

    // attachment endpoints (reached via the backend's http-proxy-middleware
    // or via CouchdbService.delete)
    this.app.get('/:db/:docId/:property', (req, res) => {
      const doc = this.getDb(req.params.db).get(req.params.docId);
      const attachment = doc?.[`attachment:${req.params.property}`];
      if (!attachment) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      res.setHeader('content-type', 'application/octet-stream');
      res.send(attachment);
    });

    this.app.put('/:db/:docId/:property', (req, res) => {
      const docs = this.getDb(req.params.db);
      const stored = this.putDoc(req.params.db, {
        ...(docs.get(req.params.docId) ?? {}),
        _id: req.params.docId,
        [`attachment:${req.params.property}`]: 'uploaded',
      });
      res.status(201).json({ ok: true, id: stored._id, rev: stored._rev });
    });

    this.app.delete('/:db/:docId/:property', (req, res) => {
      const docs = this.getDb(req.params.db);
      const doc = docs.get(req.params.docId);
      if (!doc?.[`attachment:${req.params.property}`]) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      delete doc[`attachment:${req.params.property}`];
      res.json({ ok: true, id: req.params.docId, rev: doc._rev });
    });

    // HEAD must be registered before GET: express serves HEAD requests
    // through matching GET routes otherwise
    this.app.head('/:db/:docId', (req, res) => {
      const doc = this.getDb(req.params.db).get(req.params.docId);
      if (!doc || doc._deleted) {
        return res.status(404).end();
      }
      res.setHeader('ETag', `"${doc._rev}"`);
      res.end();
    });

    this.app.get('/:db/:docId', (req, res) => {
      const doc = this.getDb(req.params.db).get(req.params.docId);
      if (!doc || doc._deleted) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      res.json(doc);
    });

    this.app.put('/:db/:docId', (req, res) => {
      const stored = this.putDoc(req.params.db, {
        ...(req.body as Record<string, unknown>),
        _id: req.params.docId,
      });
      res.status(201).json({ ok: true, id: stored._id, rev: stored._rev });
    });

    this.app.delete('/:db/:docId', (req, res) => {
      const id = req.params.docId;
      const docs = this.getDb(req.params.db);
      if (!docs.has(id)) {
        return res.status(404).json({ error: 'not_found', reason: 'missing' });
      }
      this.deleteDoc(req.params.db, id);
      res.json({ ok: true, id, rev: docs.get(id)?._rev ?? '0-deleted' });
    });
  }
}
