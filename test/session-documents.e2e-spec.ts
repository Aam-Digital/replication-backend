import request from 'supertest';
import { basicAuth, startTestApp, TestContext } from './utils/test-app';

/**
 * E2E tests for session handling and single-document CRUD,
 * running the full AppModule against a mocked CouchDB.
 */
describe('Session & document endpoints (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp((couch) => {
      couch.putDoc('app', { _id: 'Child:1', name: 'child one' });
      couch.putDoc('app', { _id: 'School:1', name: 'school one' });
      couch.putDoc('app', {
        _id: 'Note:1',
        subject: 'authored note',
        authors: ['user'],
      });
      couch.putDoc('app', {
        _id: 'Note:2',
        subject: 'foreign note',
        authors: ['someone-else'],
      });
      couch.putDoc('app', { _id: 'Aggregate:1', total: 5 });
    });
  });

  afterAll(() => ctx.stop());

  describe('/_session', () => {
    it('POST logs in with body credentials and sets a JWT cookie', async () => {
      const res = await request(ctx.app.getHttpServer())
        .post('/_session')
        .send({ name: 'user', password: 'user-pw' })
        .expect(201);
      expect(res.body).toMatchObject({ name: 'user', roles: ['user_app'] });
      expect(
        res.headers['set-cookie']?.find((h: string) =>
          h.includes('access_token='),
        ),
      ).toBeDefined();
    });

    it('POST rejects invalid credentials', () => {
      return request(ctx.app.getHttpServer())
        .post('/_session')
        .send({ name: 'user', password: 'wrong' })
        .expect(401);
    });

    it('GET returns the user info for basic auth', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/_session')
        .set(...basicAuth('admin', 'admin-pw'))
        .expect(200);
      expect(res.body).toEqual({
        ok: true,
        userCtx: { name: 'admin', roles: ['admin_app'] },
      });
    });

    it('GET allows the JWT cookie from login as authentication', async () => {
      const login = await request(ctx.app.getHttpServer())
        .post('/_session')
        .send({ name: 'user', password: 'user-pw' })
        .expect(201);
      const cookieHeader = login.headers['set-cookie'].find((h: string) =>
        h.includes('access_token='),
      );
      const cookie = cookieHeader!.split(';')[0];

      const res = await request(ctx.app.getHttpServer())
        .get('/_session')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.userCtx).toMatchObject({ name: 'user' });
    });

    it('GET without auth returns ok without user context', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/_session')
        .expect(200);
      expect(res.body.userCtx ?? null).toBeNull();
    });
  });

  describe('GET /:db/:docId', () => {
    it('returns a document the user has read permission for', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get('/app/Child:1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
      expect(res.body).toMatchObject({ _id: 'Child:1', name: 'child one' });
    });

    it('returns a document matching a condition rule with user variable', () => {
      return request(ctx.app.getHttpServer())
        .get('/app/Note:1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(200);
    });

    it('rejects a document failing the condition rule', () => {
      return request(ctx.app.getHttpServer())
        .get('/app/Note:2')
        .set(...basicAuth('user', 'user-pw'))
        .expect(401);
    });

    it('rejects a document type without any rule', () => {
      return request(ctx.app.getHttpServer())
        .get('/app/School:1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(401);
    });

    it('grants admin access to any document', () => {
      return request(ctx.app.getHttpServer())
        .get('/app/School:1')
        .set(...basicAuth('admin', 'admin-pw'))
        .expect(200);
    });

    it('serves public rules to anonymous users', async () => {
      await request(ctx.app.getHttpServer())
        .get('/app/Aggregate:1')
        .expect(200);
      await request(ctx.app.getHttpServer()).get('/app/Child:1').expect(401);
    });
  });

  describe('PUT /:db/:docId', () => {
    it('creates a document the user has create permission for', async () => {
      const res = await request(ctx.app.getHttpServer())
        .put('/app/Child:new')
        .set(...basicAuth('user', 'user-pw'))
        .send({ name: 'new child' })
        .expect(200);
      expect(res.body).toMatchObject({ ok: true, id: 'Child:new' });
      expect(ctx.couch.dbs.get('app')!.get('Child:new')).toMatchObject({
        name: 'new child',
      });
    });

    it('rejects creating a document without create permission', () => {
      return request(ctx.app.getHttpServer())
        .put('/app/School:new')
        .set(...basicAuth('user', 'user-pw'))
        .send({ name: 'new school' })
        .expect(401);
    });

    it('updates a document matching the condition rule', async () => {
      const existing = ctx.couch.dbs.get('app')!.get('Note:1')!;
      await request(ctx.app.getHttpServer())
        .put('/app/Note:1')
        .set(...basicAuth('user', 'user-pw'))
        .send({
          ...existing,
          subject: 'updated subject',
        })
        .expect(200);
      expect(ctx.couch.dbs.get('app')!.get('Note:1')).toMatchObject({
        subject: 'updated subject',
      });
    });

    it('rejects updating a document failing the condition rule', () => {
      const existing = ctx.couch.dbs.get('app')!.get('Note:2')!;
      return request(ctx.app.getHttpServer())
        .put('/app/Note:2')
        .set(...basicAuth('user', 'user-pw'))
        .send({ ...existing, subject: 'hijacked' })
        .expect(401);
    });
  });

  describe('DELETE /:db/:docId', () => {
    it('rejects deletion without delete permission', () => {
      // user_app may read/update Note:1 but has no delete rule
      return request(ctx.app.getHttpServer())
        .delete('/app/Note:1')
        .set(...basicAuth('user', 'user-pw'))
        .expect(401);
    });

    it('allows admin to delete', async () => {
      ctx.couch.putDoc('app', { _id: 'School:to-delete' });
      await request(ctx.app.getHttpServer())
        .delete('/app/School:to-delete')
        .set(...basicAuth('admin', 'admin-pw'))
        .expect(200);
      expect(ctx.couch.dbs.get('app')!.get('School:to-delete')).toMatchObject({
        _deleted: true,
      });
    });
  });
});
