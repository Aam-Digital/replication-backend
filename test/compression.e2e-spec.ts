import request from 'supertest';
import zlib from 'zlib';
import { basicAuth, startTestApp, TestContext } from './utils/test-app';

/**
 * E2E tests for response compression of the backend's own endpoints.
 */
describe('Response compression (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp((couch) => {
      couch.putDoc('app', {
        _id: 'Child:big',
        name: 'big child',
        // larger than the 1kb compression threshold
        payload: 'x'.repeat(4000),
      });
      couch.putDoc('app', { _id: 'Child:small', name: 'tiny' });
      // far more than the compression stream buffers, so streaming them
      // back-pressures it many times
      for (let i = 0; i < 100; i++) {
        couch.putDoc('app', {
          _id: `Child:bulk-${i}`,
          bulk: true,
          payload: 'x'.repeat(10_000),
        });
      }
    });
  });

  afterAll(() => ctx.stop());

  afterEach(() => jest.restoreAllMocks());

  it('gzips large JSON responses when the client accepts it', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/Child:big')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBe('gzip');
    // supertest decompresses transparently
    expect(res.body).toMatchObject({ _id: 'Child:big' });
    expect(res.body.payload).toHaveLength(4000);
  });

  it('does not compress when the client does not accept encodings', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/Child:big')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'identity')
      .expect(200);

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body).toMatchObject({ _id: 'Child:big' });
  });

  it('does not compress small responses below the threshold', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/Child:small')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('compresses replication endpoint responses', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/_all_docs?include_docs=true')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBe('gzip');
    const ids = res.body.rows.map((r: { id: string }) => r.id);
    expect(ids).toContain('Child:big');
  });

  it('compresses _bulk_get responses', async () => {
    const res = await request(ctx.app.getHttpServer())
      .post('/app/_bulk_get')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .send({ docs: [{ id: 'Child:big' }, { id: 'Child:small' }] })
      .expect(200);

    expect(res.headers['content-encoding']).toBe('gzip');
    const ids = res.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain('Child:big');
    expect(ids).toContain('Child:small');
    const bigResult = res.body.results.find((r: { id: string }) => r.id === 'Child:big');
    expect(bigResult.docs[0].ok).toMatchObject({ _id: 'Child:big', payload: 'x'.repeat(4000) });
  });

  it('does not pile up drain listeners on the compression stream of a back-pressured response', async () => {
    // the middleware creates its compression stream internally, so reach it
    // through the listeners registered on it
    const on = jest.spyOn(zlib.BrotliCompress.prototype, 'on');

    const res = await request(ctx.app.getHttpServer())
      .post('/app/_find')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'br')
      .send({ selector: { bulk: true }, limit: 100 })
      .expect(200);

    expect(res.headers['content-encoding']).toBe('br');
    expect(res.body.docs).toHaveLength(100);
    const compressStream = on.mock.contexts[0] as zlib.BrotliCompress;
    expect(compressStream.listenerCount('drain')).toBeLessThanOrEqual(1);
  });

  it('compresses _changes responses', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/_changes?include_docs=true')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBe('gzip');
    const ids = res.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain('Child:big');
    const bigChange = res.body.results.find((r: { id: string }) => r.id === 'Child:big');
    expect(bigChange.doc).toMatchObject({ _id: 'Child:big', payload: 'x'.repeat(4000) });
    expect(res.body.last_seq).toBeDefined();
  });

  it('compresses longpoll _changes responses', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app/_changes?feed=longpoll&include_docs=true&timeout=100')
      .set(...basicAuth('admin', 'admin-pw'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);

    expect(res.headers['content-encoding']).toBe('gzip');
    const ids = res.body.results.map((r: { id: string }) => r.id);
    expect(ids).toContain('Child:big');
    const bigChange = res.body.results.find((r: { id: string }) => r.id === 'Child:big');
    expect(bigChange.doc).toMatchObject({ _id: 'Child:big', payload: 'x'.repeat(4000) });
    expect(res.body.last_seq).toBeDefined();
  });
});
