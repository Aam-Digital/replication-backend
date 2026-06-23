import request from 'supertest';
import { startTestApp } from './utils/test-app';

// AUDIT_ENABLED is read into ConfigService at app startup, so each case boots a
// fresh app with the env set beforehand. Restore the original value afterwards.
const originalAuditEnabled = process.env.AUDIT_ENABLED;

afterEach(() => {
  if (originalAuditEnabled === undefined) {
    delete process.env.AUDIT_ENABLED;
  } else {
    process.env.AUDIT_ENABLED = originalAuditEnabled;
  }
});

it('GET /_features/audit returns enabled=true when AUDIT_ENABLED=true (public, not captured by the /:db proxy routes)', async () => {
  process.env.AUDIT_ENABLED = 'true';
  const ctx = await startTestApp();
  try {
    // unauthenticated request: a 200 with the feature body proves the literal
    // route wins over /:db/:docId (which would otherwise treat this as db
    // `_features`, doc `audit`) and needs no auth
    await request(ctx.app.getHttpServer())
      .get('/_features/audit')
      .expect(200)
      .expect({ enabled: true });
  } finally {
    await ctx.stop();
  }
});

it('GET /_features/audit returns enabled=false when AUDIT_ENABLED is unset', async () => {
  delete process.env.AUDIT_ENABLED;
  const ctx = await startTestApp();
  try {
    await request(ctx.app.getHttpServer())
      .get('/_features/audit')
      .expect(200)
      .expect({ enabled: false });
  } finally {
    await ctx.stop();
  }
});
