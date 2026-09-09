import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, KeyObject } from 'crypto';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';
import { of } from 'rxjs';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { KeycloakUserAdminService } from '../../../permissions/user-identity/keycloak-user-admin.service';
import { JwtBearerStrategy } from './jwt-bearer.strategy';

/**
 * These tests spin up a real HTTP server serving a JWKS document and sign
 * real RS256 tokens against it, then drive the strategy's `authenticate()`
 * (not just `validate()`, which only runs after passport-jwt already
 * verified the signature) - this is the only way to actually exercise the
 * secretOrKeyProvider wiring. A unit test that only calls `validate()` with a
 * hand-built payload would pass even if the JWKS lookup were broken.
 */
describe('JwtBearerStrategy', () => {
  const REALM = 'testrealm';
  const KID = 'test-kid-1';

  let jwksServer: http.Server;
  let jwksBaseUrl: string;
  let privateKey: string;
  let jwksResponse: { keys: unknown[] };

  beforeAll(async () => {
    const { publicKey, privateKey: privKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKey = privKey.export({ type: 'pkcs1', format: 'pem' }) as string;
    const jwk = (publicKey as KeyObject).export({ format: 'jwk' }) as Record<
      string,
      unknown
    >;
    jwksResponse = { keys: [{ ...jwk, kid: KID, use: 'sig', alg: 'RS256' }] };

    jwksServer = http.createServer((req, res) => {
      if (req.url === `/realms/${REALM}/protocol/openid-connect/certs`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(jwksResponse));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, '127.0.0.1', () => resolve()),
    );
    const { port } = jwksServer.address() as AddressInfo;
    jwksBaseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => jwksServer.close(resolve));
  });

  function configServiceStub(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  function buildStrategy(
    overrides: Record<string, string | undefined> = {},
  ): JwtBearerStrategy {
    const configService = configServiceStub({
      [KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]: jwksBaseUrl,
      [KeycloakUserAdminService.ENV_KEYCLOAK_REALM]: REALM,
      ...overrides,
    });
    const couchdbService = {
      get: jest.fn().mockReturnValue(of(undefined)),
    } as unknown as CouchdbService;
    return new JwtBearerStrategy(configService, couchdbService);
  }

  function signToken(overrides: Partial<jwt.SignOptions> = {}): string {
    return jwt.sign(
      { username: 'User:jane', '_couchdb.roles': ['user_app'] },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: KID,
        issuer: `${jwksBaseUrl}/realms/${REALM}`,
        subject: 'jane-sub',
        expiresIn: '5m',
        ...overrides,
      },
    );
  }

  /** Drives passport's event-based authenticate() as a promise. */
  function authenticate(
    strategy: JwtBearerStrategy,
    token: string,
  ): Promise<unknown> {
    const req = { headers: { authorization: `Bearer ${token}` } };
    return new Promise((resolve, reject) => {
      (strategy as unknown as { success: (u: unknown) => void }).success = (
        user,
      ) => resolve(user);
      (strategy as unknown as { fail: (info: unknown) => void }).fail = (
        info,
      ) => reject(new Error(`authentication failed: ${JSON.stringify(info)}`));
      (strategy as unknown as { error: (err: unknown) => void }).error = (
        err,
      ) => reject(err instanceof Error ? err : new Error(String(err)));
      (strategy as unknown as { authenticate: (req: unknown) => void }).authenticate(
        req,
      );
    });
  }

  it('throws when KEYCLOAK_ADMIN_BASE_URL is missing', () => {
    expect(() =>
      buildStrategy({
        [KeycloakUserAdminService.ENV_KEYCLOAK_ADMIN_BASE_URL]: undefined,
      }),
    ).toThrow(/KEYCLOAK_ADMIN_BASE_URL/);
  });

  it('throws when KEYCLOAK_REALM is missing', () => {
    expect(() =>
      buildStrategy({
        [KeycloakUserAdminService.ENV_KEYCLOAK_REALM]: undefined,
      }),
    ).toThrow(/KEYCLOAK_REALM/);
  });

  it('authenticates a token signed with a key served by the realm JWKS', async () => {
    const strategy = buildStrategy();

    const user = await authenticate(strategy, signToken());

    expect(user).toMatchObject({
      id: 'jane-sub',
      name: 'User:jane',
      roles: ['user_app'],
    });
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const strategy = buildStrategy();

    await expect(
      authenticate(strategy, signToken({ keyid: 'unknown-kid' })),
    ).rejects.toThrow();
  });

  it('rejects a token issued for a different realm/issuer', async () => {
    const strategy = buildStrategy();

    await expect(
      authenticate(
        strategy,
        signToken({ issuer: 'https://not-the-configured-realm.example.com' }),
      ),
    ).rejects.toThrow();
  });
});
