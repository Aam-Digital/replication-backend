import request from 'supertest';
import { basicAuth, startTestApp, TestContext } from './utils/test-app';

/**
 * E2E tests for the attachment endpoints, which check permissions on the
 * underlying entity and proxy the actual data transfer to CouchDB.
 */
describe('Attachment endpoints (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await startTestApp((couch) => {
      couch.putDoc('app', { _id: 'Child:1', name: 'child one' });
      couch.putDoc('app', { _id: 'School:1', name: 'school one' });
      couch.putDoc('app', {
        _id: 'Note:1',
        subject: 'authored',
        authors: ['user'],
      });
      couch.putDoc('app-attachments', {
        _id: 'Child:1',
        'attachment:photo': 'fake-binary-data',
      });
      couch.putDoc('app-attachments', {
        _id: 'School:1',
        'attachment:photo': 'secret-binary-data',
      });
      couch.putDoc('app-attachments', {
        _id: 'Note:1',
        'attachment:file': 'note-file-data',
      });
    });
  });

  afterAll(() => ctx.stop());

  it('streams an attachment the user may read', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/app-attachments/Child:1/photo')
      .set(...basicAuth('user', 'user-pw'))
      .buffer(true)
      .expect(200);
    expect(res.body.toString()).toBe('fake-binary-data');
  });

  it('rejects reading attachments of entities without read permission', () => {
    return request(ctx.app.getHttpServer())
      .get('/app-attachments/School:1/photo')
      .set(...basicAuth('user', 'user-pw'))
      .expect(403);
  });

  it('rejects anonymous attachment access', () => {
    return request(ctx.app.getHttpServer())
      .get('/app-attachments/Child:1/photo')
      .expect(401);
  });

  it('uploads an attachment through the proxy with internal credentials', async () => {
    ctx.couch.clearRequestLog();
    await request(ctx.app.getHttpServer())
      .put('/app-attachments/Child:1/photo?rev=1-mock')
      .set(...basicAuth('user', 'user-pw'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('new-binary-data'))
      .expect(201);

    const forwarded = ctx.couch.requestsFor(
      'PUT',
      '/app-attachments/Child:1/photo',
    );
    expect(forwarded).toHaveLength(1);
    // proxy replaces the user's credentials with the internal db user
    const authHeader = forwarded[0].headers.authorization as string;
    expect(
      Buffer.from(authHeader.replace('Basic ', ''), 'base64').toString(),
    ).toBe('internal-admin:internal-admin-pw');
  });

  it('deletes an attachment when user may update the entity', async () => {
    await request(ctx.app.getHttpServer())
      .delete('/app-attachments/Note:1/file')
      .set(...basicAuth('user', 'user-pw'))
      .expect(200);
    expect(
      ctx.couch.dbs.get('app-attachments')!.get('Note:1')!['attachment:file'],
    ).toBeUndefined();
  });

  it('rejects deleting attachments of entities without edit permission', () => {
    return request(ctx.app.getHttpServer())
      .delete('/app-attachments/School:1/photo')
      .set(...basicAuth('user', 'user-pw'))
      .expect(403);
  });
});
