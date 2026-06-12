import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { MockCouchDb } from './mock-couchdb';

/**
 * Permission rules seeded for most e2e tests:
 * - role `admin_app`: full access
 * - role `user_app`: read Child; read/update Note only when listed in its
 *   `authors` (exercises condition rules with `${user.name}` injection);
 *   create Child
 * - anonymous (public): read Aggregate
 */
export const DEFAULT_TEST_RULES = {
  public: [{ action: 'read', subject: 'Aggregate' }],
  admin_app: [{ action: 'manage', subject: 'all' }],
  user_app: [
    { action: 'read', subject: 'Child' },
    { action: 'create', subject: 'Child' },
    {
      action: ['read', 'update'],
      subject: 'Note',
      conditions: { authors: { $elemMatch: { $eq: '${user.name}' } } },
    },
  ],
};

export interface TestContext {
  app: INestApplication;
  couch: MockCouchDb;
  stop: () => Promise<void>;
}

/**
 * Boots the full AppModule against an in-process mock CouchDB.
 *
 * Seeds two users (`admin` with role admin_app, `user` with role user_app)
 * and the Config:Permissions document (override via `seed` before startup).
 */
export async function startTestApp(
  seed?: (couch: MockCouchDb) => void,
): Promise<TestContext> {
  const couch = new MockCouchDb();
  couch.addUser('admin', 'admin-pw', ['admin_app']);
  couch.addUser('user', 'user-pw', ['user_app']);
  couch.putDoc('app', {
    _id: 'Config:Permissions',
    data: DEFAULT_TEST_RULES,
  });
  seed?.(couch);
  await couch.start();

  process.env.DATABASE_URL = couch.url;
  process.env.DATABASE_USER = 'internal-admin';
  process.env.DATABASE_PASSWORD = 'internal-admin-pw';
  process.env.PERMISSION_DB = 'app';
  process.env.JWT_SECRET = 'e2e-test-jwt-secret';
  process.env.JWT_PUBLIC_KEY =
    '-----BEGIN PUBLIC KEY-----\ne2e-test\n-----END PUBLIC KEY-----';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // mirror main.ts bootstrap: body parsing is applied as middleware
  // by RestrictedEndpointsModule (10mb limit), not by the framework default
  const app = moduleFixture.createNestApplication({
    bodyParser: false,
    logger: false,
  });
  app.use(cookieParser());
  await app.init();

  couch.clearRequestLog();

  return {
    app,
    couch,
    stop: async () => {
      await app.close();
      await couch.stop();
    },
  };
}

/** supertest helper: basic auth header for a seeded user */
export function basicAuth(name: string, password: string): [string, string] {
  return [
    'Authorization',
    'Basic ' + Buffer.from(`${name}:${password}`).toString('base64'),
  ];
}

/** Polls until `condition` is truthy (supports async conditions). */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
