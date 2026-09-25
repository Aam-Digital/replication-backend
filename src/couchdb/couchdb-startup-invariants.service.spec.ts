import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { RulesService } from '../permissions/rules/rules.service';
import { CouchdbStartupInvariantsService } from './couchdb-startup-invariants.service';
import { CouchdbService } from './couchdb.service';

type SecurityDoc = {
  admins?: { names?: string[]; roles?: string[] };
  members?: { names?: string[]; roles?: string[] };
};

function fakeHttpException(status: number): HttpException {
  return new HttpException({ error: 'fake' }, status);
}

describe('CouchdbStartupInvariantsService', () => {
  let couchdbService: jest.Mocked<Pick<CouchdbService, 'createDb' | 'get'>>;
  let configService: ConfigService;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  /** the canonical document create-couchdb.sh's --with-permissions mode applies */
  const lockedDownSecurity: SecurityDoc = {
    admins: { names: [], roles: ['_admin'] },
    members: { names: [], roles: ['_admin'] },
  };

  const emptySecurity: SecurityDoc = {
    admins: { names: [], roles: [] },
    members: { names: [], roles: [] },
  };

  beforeEach(() => {
    couchdbService = {
      createDb: jest.fn().mockReturnValue(of({ ok: true })),
      get: jest.fn(),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) } as any;
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function buildService(): CouchdbStartupInvariantsService {
    return new CouchdbStartupInvariantsService(
      couchdbService as unknown as CouchdbService,
      configService,
    );
  }

  /**
   * Stubs `couchdbService.get` for all four checks at once, defaulting to the
   * happy path (both dbs locked down, no jwt_keys, anonymous access blocked)
   * and overriding only what a test cares about.
   */
  function stubCouchdb({
    securityByDb = {},
    jwtKeys = 'absent',
    requireValidUser = 'true',
  }: {
    securityByDb?: Record<string, SecurityDoc | 'unreadable'>;
    jwtKeys?: 'absent' | 'forbidden' | Record<string, string>;
    requireValidUser?: string | boolean | 'unset' | 'forbidden';
  } = {}) {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security') {
        const security = securityByDb[db!];
        if (security === 'unreadable') {
          return throwError(() => new Error('unreadable response')) as any;
        }
        return of(security ?? lockedDownSecurity) as any;
      }
      if (docId === 'jwt_keys') {
        if (jwtKeys === 'absent')
          return throwError(() => fakeHttpException(404)) as any;
        if (jwtKeys === 'forbidden')
          return throwError(() => fakeHttpException(403)) as any;
        return of(jwtKeys) as any;
      }
      if (docId === 'require_valid_user') {
        if (requireValidUser === 'unset')
          return throwError(() => fakeHttpException(404)) as any;
        if (requireValidUser === 'forbidden')
          return throwError(() => fakeHttpException(403)) as any;
        return of(requireValidUser) as any;
      }
      return of(undefined) as any;
    });
  }

  it('creates the primary and attachments databases (idempotent)', async () => {
    stubCouchdb();
    const service = buildService();

    await service.onModuleInit();

    expect(couchdbService.createDb).toHaveBeenCalledWith('app');
    expect(couchdbService.createDb).toHaveBeenCalledWith('app-attachments');
  });

  it('uses PERMISSION_DB instead of the default "app" when configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) =>
      key === RulesService.ENV_PERMISSION_DB ? 'custom-db' : undefined,
    );
    stubCouchdb();
    const service = buildService();

    await service.onModuleInit();

    expect(couchdbService.createDb).toHaveBeenCalledWith('custom-db');
    expect(couchdbService.createDb).toHaveBeenCalledWith('app-attachments');
    expect(couchdbService.get).toHaveBeenCalledWith('custom-db', '_security');
  });

  it('logs nothing on the full happy path (locked-down security, no jwt_keys, anonymous access blocked)', async () => {
    stubCouchdb();
    const service = buildService();

    await service.onModuleInit();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  describe('_security', () => {
    it.each<[string, SecurityDoc]>([
      ['admins.roles re-asserted as _admin', lockedDownSecurity],
      [
        'admins fully empty (no extra grant, no explicit _admin role either)',
        {
          admins: { names: [], roles: [] },
          members: { names: [], roles: ['_admin'] },
        },
      ],
    ])('does not log CRITICAL when %s', async (_label, security) => {
      stubCouchdb({ securityByDb: { app: security } });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it.each<[string, SecurityDoc, RegExp]>([
      ['is empty', emptySecurity, /empty _security document/],
      [
        'grants a permissive member role',
        {
          admins: { names: [], roles: [] },
          members: { names: [], roles: ['user_app'] },
        },
        /non-admin-only/,
      ],
      [
        'grants an extra db admin name',
        {
          admins: { names: ['some-other-user'], roles: [] },
          members: { names: [], roles: ['_admin'] },
        },
        /non-admin-only/,
      ],
      [
        'grants the _admin role plus another member role',
        {
          admins: { names: [], roles: ['_admin'] },
          members: { names: [], roles: ['_admin', 'user_app'] },
        },
        /non-admin-only/,
      ],
    ])(
      "logs CRITICAL when the primary db's _security %s",
      async (_label, security, messagePattern) => {
        stubCouchdb({ securityByDb: { app: security } });
        const service = buildService();

        await service.onModuleInit();

        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringMatching(messagePattern),
          expect.objectContaining({ db: 'app' }),
        );
      },
    );

    it('logs CRITICAL for the attachments db too (both dbs are checked independently)', async () => {
      stubCouchdb({
        securityByDb: {
          'app-attachments': {
            admins: { names: [], roles: [] },
            members: { names: [], roles: ['user_app'] },
          },
        },
      });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-admin-only'),
        expect.objectContaining({ db: 'app-attachments' }),
      );
    });

    it('logs CRITICAL but still checks the other db when a _security document is unreadable', async () => {
      stubCouchdb({ securityByDb: { app: 'unreadable' } });
      const service = buildService();

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*Could not verify/),
        expect.objectContaining({ db: 'app', error: 'unreadable response' }),
      );
      expect(couchdbService.get).toHaveBeenCalledWith(
        'app-attachments',
        '_security',
      );
      expect(couchdbService.get).toHaveBeenCalledWith(
        '_node/_local/_config',
        'jwt_keys',
      );
    });
  });

  describe('jwt_keys', () => {
    it('logs CRITICAL when jwt_keys is configured', async () => {
      stubCouchdb({ jwtKeys: { 'rsa:kid1': '-----BEGIN PUBLIC KEY-----...' } });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        expect.objectContaining({ configuredKeyIds: ['rsa:kid1'] }),
      );
    });

    it('logs "could not verify" instead of failing when the check is forbidden', async () => {
      stubCouchdb({ jwtKeys: 'forbidden' });
      const service = buildService();

      await service.onModuleInit();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not verify'),
        expect.anything(),
      );
    });
  });

  describe('require_valid_user', () => {
    it('logs CRITICAL when confirmed false', async () => {
      stubCouchdb({ requireValidUser: 'false' });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('require_valid_user'),
        expect.objectContaining({ requireValidUser: 'false' }),
      );
    });

    it('logs CRITICAL when unset (404) - unlike jwt_keys, absence is not safe here', async () => {
      stubCouchdb({ requireValidUser: 'unset' });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('require_valid_user'),
        expect.objectContaining({ requireValidUser: 'false' }),
      );
    });

    it('accepts a JSON boolean true, not just the string "true"', async () => {
      stubCouchdb({ requireValidUser: true });
      const service = buildService();

      await service.onModuleInit();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs "could not verify" instead of failing when the check is forbidden', async () => {
      stubCouchdb({ requireValidUser: 'forbidden' });
      const service = buildService();

      await service.onModuleInit();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Could not verify whether CouchDB allows anonymous requests',
        ),
        expect.anything(),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
