import request from 'supertest';
import {
  basicAuth,
  DEFAULT_TEST_RULES,
  startTestApp,
  TestContext,
  waitFor,
} from './utils/test-app';

/**
 * E2E tests for the admin endpoints and live permission-change propagation
 * through the CouchDB _changes longpoll feed.
 */
describe('Admin & permission updates (e2e)', () => {
  let ctx: TestContext;

  const seedLocalDocs = () => {
    ctx.couch.putDoc('app', { _id: '_local/checkpoint-1' });
    ctx.couch.putDoc('app', { _id: '_local/checkpoint-2' });
    ctx.couch.putDoc('app', { _id: '_local/purge-mrview-abc' });
    ctx.couch.putDoc('app', { _id: '_local/shard-sync-def' });
  };

  beforeAll(async () => {
    ctx = await startTestApp((couch) => {
      couch.putDoc('app', { _id: 'School:1', name: 'school one' });
    });
  });

  afterAll(() => ctx.stop());

  describe('POST /admin/clear_local/:db', () => {
    it('rejects unauthenticated requests', () => {
      return request(ctx.app.getHttpServer())
        .post('/admin/clear_local/app')
        .expect(401);
    });

    it('deletes replication checkpoints but keeps couchdb-internal local docs', async () => {
      seedLocalDocs();
      ctx.couch.clearRequestLog();

      await request(ctx.app.getHttpServer())
        .post('/admin/clear_local/app')
        .set(...basicAuth('admin', 'admin-pw'))
        .expect(201);

      const deleted = ctx.couch
        .requestsFor('DELETE', '/app/_local/')
        .map((r) => r.url);
      expect(deleted.sort()).toEqual([
        '/app/_local/checkpoint-1',
        '/app/_local/checkpoint-2',
      ]);
      expect(ctx.couch.dbs.get('app')!.has('_local/checkpoint-1')).toBe(false);
      expect(ctx.couch.dbs.get('app')!.has('_local/purge-mrview-abc')).toBe(
        true,
      );
      expect(ctx.couch.dbs.get('app')!.has('_local/shard-sync-def')).toBe(true);
    });
  });

  describe('permission config changes via the changes feed', () => {
    it('applies updated rules live and triggers clearLocal', async () => {
      // before the change: user_app has no access to School docs
      await request(ctx.app.getHttpServer())
        .get('/app/School:1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(401);

      seedLocalDocs();
      ctx.couch.clearRequestLog();

      // simulate a permission config update arriving in CouchDB
      ctx.couch.putDoc('app', {
        _id: 'Config:Permissions',
        data: {
          ...DEFAULT_TEST_RULES,
          user_app: [
            ...DEFAULT_TEST_RULES.user_app,
            { action: 'read', subject: 'School' },
          ],
        },
      });

      // new rules are picked up through the longpoll feed
      await waitFor(async () => {
        const res = await request(ctx.app.getHttpServer())
          .get('/app/School:1')
          .set(...basicAuth('user', 'user-pw'));
        return res.status === 200;
      });

      // the rule change re-triggers client syncs by clearing checkpoints
      await waitFor(
        () => ctx.couch.requestsFor('DELETE', '/app/_local/').length >= 2,
      );
      const deleted = ctx.couch
        .requestsFor('DELETE', '/app/_local/')
        .map((r) => r.url);
      expect(deleted).toContain('/app/_local/checkpoint-1');
      expect(deleted).not.toContain('/app/_local/purge-mrview-abc');
    });
  });
});
