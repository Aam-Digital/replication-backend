import request from 'supertest';
import { basicAuth, startTestApp, TestContext } from './utils/test-app';

/**
 * E2E tests for the replication / bulk endpoints (_changes, _bulk_get,
 * _all_docs, _bulk_docs, _find), running the full AppModule against a
 * mocked CouchDB and asserting permission filtering behavior.
 */
describe('Replication endpoints (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp((couch) => {
      couch.putDoc('app', { _id: 'Child:1', name: 'child one' });
      couch.putDoc('app', { _id: 'Child:2', name: 'child two' });
      couch.putDoc('app', { _id: 'School:1', name: 'school one' });
      couch.putDoc('app', {
        _id: 'Note:1',
        subject: 'authored',
        authors: ['user'],
      });
      couch.putDoc('app', {
        _id: 'Note:2',
        subject: 'foreign',
        authors: ['someone-else'],
      });
      couch.putDoc('app', { _id: '_design/some-view', views: {} });
      couch.putDoc('app', { _id: 'Child:deleted' });
      couch.deleteDoc('app', 'Child:deleted');
    });
  });

  afterAll(() => ctx.stop());

  describe('GET /:db/_changes', () => {
    it('returns only permitted changes and reports lost permissions', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/app/_changes')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);

      const ids = res.body.results.map((r: { id: string }) => r.id);
      expect(ids).toContain('Child:1');
      expect(ids).toContain('Child:2');
      expect(ids).toContain('Note:1');
      expect(ids).toContain('Child:deleted'); // tombstones pass through
      expect(ids).not.toContain('School:1');
      expect(ids).not.toContain('Note:2');
      expect(ids).not.toContain('_design/some-view'); // filtered prefix
      expect(ids).not.toContain('Config:Permissions');

      // notifies the client to purge docs it may no longer access
      expect(res.body.lostPermissions).toContain('School:1');
      expect(res.body.lostPermissions).toContain('Note:2');
      expect(res.body.lostPermissions).not.toContain('_design/some-view');

      expect(res.body.pending).toBe(0);
      expect(res.body.last_seq).toBeDefined();
    });

    it('omits doc content unless include_docs is requested', async () => {
      const withoutDocs = await request(ctx.app.getHttpServer())
        .get('/app/_changes')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      for (const result of withoutDocs.body.results) {
        expect(result.doc).toBeUndefined();
      }

      const withDocs = await request(ctx.app.getHttpServer())
        .get('/app/_changes?include_docs=true')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      const child = withDocs.body.results.find(
        (r: { id: string }) => r.id === 'Child:1',
      );
      expect(child.doc).toMatchObject({ _id: 'Child:1', name: 'child one' });
    });

    it('respects the limit parameter and reports remaining as pending', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/app/_changes?limit=1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.pending).toBeGreaterThan(0);
    });

    it('continues from the returned last_seq', async () => {
      const first = await request(ctx.app.getHttpServer())
        .get('/app/_changes?limit=1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      const second = await request(ctx.app.getHttpServer())
        .get(`/app/_changes?since=${first.body.last_seq}`)
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      const firstIds = first.body.results.map((r: { id: string }) => r.id);
      const secondIds = second.body.results.map((r: { id: string }) => r.id);
      for (const id of firstIds) {
        expect(secondIds).not.toContain(id);
      }
    });

    it('returns everything for admin users', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/app/_changes')
        .set(...basicAuth('admin', 'admin-pw'))
        .expect(200);
      const ids = res.body.results.map((r: { id: string }) => r.id);
      expect(ids).toContain('School:1');
      expect(ids).toContain('Note:2');
      expect(res.body.lostPermissions).toEqual([]);
    });
  });

  describe('POST /:db/_bulk_get', () => {
    it('filters out non-permitted docs and empty results', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_bulk_get')
        .set(...basicAuth('user', 'user-pw'))
        .send({
          docs: [
            { id: 'Child:1' },
            { id: 'School:1' },
            { id: 'Note:1' },
            { id: 'Note:2' },
            { id: '_design/some-view' },
          ],
        })
        .expect(201);

      const ids = res.body.results.map((r: { id: string }) => r.id);
      expect(ids).toEqual(['Child:1', 'Note:1']);
      const childResult = res.body.results[0];
      expect(childResult.docs[0].ok).toMatchObject({ _id: 'Child:1' });
    });

    it('passes through error entries for missing docs', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_bulk_get')
        .set(...basicAuth('user', 'user-pw'))
        .send({ docs: [{ id: 'Child:does-not-exist' }] })
        .expect(201);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].docs[0].error).toMatchObject({
        error: 'not_found',
      });
    });

    it('returns deleted docs (tombstones)', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_bulk_get')
        .set(...basicAuth('user', 'user-pw'))
        .send({ docs: [{ id: 'Child:deleted' }] })
        .expect(201);
      expect(res.body.results[0].docs[0].ok).toMatchObject({ _deleted: true });
    });
  });

  describe('POST /:db/_all_docs', () => {
    it('filters rows by read permission when include_docs is set', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_all_docs?include_docs=true')
        .set(...basicAuth('user', 'user-pw'))
        .send({ keys: ['Child:1', 'School:1', 'Note:1', 'Note:2'] })
        .expect(201);
      const ids = res.body.rows.map((r: { id: string }) => r.id);
      expect(ids).toEqual(['Child:1', 'Note:1']);
    });

    // TODO: fix filterAllDocsResponse to apply permission checks even when include_docs is absent,
    // so that unauthorized doc IDs/revs are not leaked as bare metadata rows.
    // After the fix, update the expectation below to exclude 'School:1'.
    it('keeps rows without doc content when include_docs is not set', async () => {
      // current behavior: only the doc body is permission-checked,
      // bare rows (id + rev) pass through except for ignored prefixes
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_all_docs')
        .set(...basicAuth('user', 'user-pw'))
        .send({ keys: ['Child:1', 'School:1', '_design/some-view'] })
        .expect(201);
      const ids = res.body.rows.map((r: { id: string }) => r.id);
      expect(ids).toEqual(['Child:1', 'School:1']);
    });
  });

  describe('GET /:db/_all_docs', () => {
    it('filters all database rows by read permission', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/app/_all_docs?include_docs=true')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      const ids = res.body.rows.map((r: { id: string }) => r.id);
      expect(ids).toContain('Child:1');
      expect(ids).toContain('Note:1');
      expect(ids).not.toContain('School:1');
      expect(ids).not.toContain('Note:2');
      expect(ids).not.toContain('_design/some-view');
    });
  });

  // TODO(#274): response only contains forwarded docs, breaking the one-result-per-input CouchDB contract
  // https://github.com/Aam-Digital/replication-backend/issues/274
  describe('POST /:db/_bulk_docs', () => {
    it('forwards only permitted writes to CouchDB', async () => {
      ctx.couch.clearRequestLog();
      const note1 = ctx.couch.dbs.get('app')!.get('Note:1')!;
      const note2 = ctx.couch.dbs.get('app')!.get('Note:2')!;
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_bulk_docs')
        .set(...basicAuth('user', 'user-pw'))
        .send({
          docs: [
            { _id: 'Child:bulk-new', name: 'created via bulk' }, // create permitted
            { _id: 'School:bulk-new', name: 'no create permission' },
            { ...note1, bulkEdited: true }, // update permitted (author)
            { ...note2, subject: 'bulk hijacked' }, // update denied
          ],
        })
        .expect(201);

      const forwarded = ctx.couch
        .requestsFor('POST', '/app/_bulk_docs')
        .map((r) => (r.body as { docs: { _id: string }[] }).docs)
        .flat()
        .map((d) => d._id);
      expect(forwarded).toEqual(['Child:bulk-new', 'Note:1']);

      const responseIds = res.body.map((r: { id: string }) => r.id);
      expect(responseIds).toEqual(['Child:bulk-new', 'Note:1']);

      expect(ctx.couch.dbs.get('app')!.get('School:bulk-new')).toBeUndefined();
      expect(ctx.couch.dbs.get('app')!.get('Note:2')).toMatchObject({
        subject: 'foreign',
      });
    });
  });

  describe('POST /:db/_find', () => {
    it('filters query results by read permission', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/app/_find')
        .set(...basicAuth('user', 'user-pw'))
        .send({ selector: { subject: 'authored' } })
        .expect(201);
      expect(res.body.docs.map((d: { _id: string }) => d._id)).toEqual([
        'Note:1',
      ]);

      const denied = await request(ctx.app.getHttpServer())
        .post('/app/_find')
        .set(...basicAuth('user', 'user-pw'))
        .send({ selector: { subject: 'foreign' } })
        .expect(201);
      expect(denied.body.docs).toEqual([]);
    });
  });

  describe('POST /:db/_revs_diff', () => {
    it('requires authentication', async () => {
      await request(ctx.app.getHttpServer())
        .post('/app/_revs_diff')
        .send({ 'Child:1': ['1-mock'] })
        .expect(401);
      await request(ctx.app.getHttpServer())
        .post('/app/_revs_diff')
        .set(...basicAuth('user', 'user-pw'))
        .send({ 'Child:1': ['1-mock'] })
        .expect(201);
    });
  });
});
