import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NEVER, of, throwError } from 'rxjs';
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

  /** exactly what couch_bt_engine:set_default_security_object/4 persists for `default_security = admin_only` - no `names` key at all */
  const couchdbPersistedDefaultSecurity: SecurityDoc = {
    admins: { roles: ['_admin'] },
    members: { roles: ['_admin'] },
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
   * Stubs `couchdbService.get` for all checks at once, defaulting to the
   * happy path (both primary dbs and every other known database locked
   * down, no jwt_keys) and overriding only what a test cares about.
   */
  function stubCouchdb({
    securityByDb = {},
    jwtKeys = 'absent',
    allDbs = ['app', 'app-attachments', '_users', 'report-calculation'],
    allDbsResult = 'ok',
  }: {
    securityByDb?: Record<string, SecurityDoc | 'unreadable' | number>;
    jwtKeys?: 'absent' | 'forbidden' | Record<string, string>;
    allDbs?: string[];
    allDbsResult?: 'ok' | 'forbidden';
  } = {}) {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (db === undefined && docId === '_all_dbs') {
        if (allDbsResult === 'forbidden')
          return throwError(() => fakeHttpException(403)) as any;
        return of(allDbs) as any;
      }
      if (docId === '_security') {
        const security = securityByDb[db!];
        if (security === 'unreadable') {
          return throwError(() => new Error('unreadable response')) as any;
        }
        if (typeof security === 'number') {
          return throwError(() => fakeHttpException(security)) as any;
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
    await service.runSecurityChecks();

    expect(couchdbService.createDb).toHaveBeenCalledWith('custom-db');
    expect(couchdbService.createDb).toHaveBeenCalledWith('app-attachments');
    expect(couchdbService.get).toHaveBeenCalledWith('custom-db', '_security');
  });

  it('does not wait for the security checks before completing startup', async () => {
    stubCouchdb();
    couchdbService.get.mockReturnValue(NEVER as any);
    const service = buildService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('logs nothing on the full happy path (locked-down security everywhere, no jwt_keys)', async () => {
    stubCouchdb();
    const service = buildService();

    await service.runSecurityChecks();

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

      await service.runSecurityChecks();

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

        await service.runSecurityChecks();

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

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-admin-only'),
        expect.objectContaining({ db: 'app-attachments' }),
      );
    });

    it('logs CRITICAL but still checks the other db when a _security document is unreadable', async () => {
      stubCouchdb({ securityByDb: { app: 'unreadable' } });
      const service = buildService();

      await service.runSecurityChecks();

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

    it('logs CRITICAL when a primary db refuses the _security read, which leaves the stricter admin-only check unanswered', async () => {
      stubCouchdb({ securityByDb: { app: 403 } });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*Could not verify/),
        expect.objectContaining({ db: 'app', status: 403 }),
      );
    });
  });

  describe('jwt_keys', () => {
    it('logs CRITICAL when jwt_keys is configured', async () => {
      stubCouchdb({ jwtKeys: { 'rsa:kid1': '-----BEGIN PUBLIC KEY-----...' } });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        expect.objectContaining({ configuredKeyIds: ['rsa:kid1'] }),
      );
    });

    it('logs "could not verify" instead of failing when the check is forbidden', async () => {
      stubCouchdb({ jwtKeys: 'forbidden' });
      const service = buildService();

      await service.runSecurityChecks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not verify'),
        expect.anything(),
      );
    });
  });

  describe('any database open to anyone', () => {
    it("does not double-log when the primary db's _security is empty (already covered by assertSecurityIsLockedDown)", async () => {
      stubCouchdb({ securityByDb: { app: emptySecurity } });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('logs CRITICAL for any other database on the server whose _security is empty', async () => {
      stubCouchdb({
        securityByDb: { 'report-calculation': emptySecurity },
      });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/empty _security document/),
        expect.objectContaining({ db: 'report-calculation' }),
      );
    });

    it('does not flag a database whose _security was persisted admin-only by CouchDB itself (no explicit PUT ever made)', async () => {
      stubCouchdb({
        allDbs: ['app', 'app-attachments', '_users', 'report-calculation'],
        securityByDb: {
          _users: couchdbPersistedDefaultSecurity,
          'report-calculation': couchdbPersistedDefaultSecurity,
        },
      });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('logs CRITICAL but still checks remaining databases when a _security document is unreadable', async () => {
      stubCouchdb({
        securityByDb: {
          _users: 'unreadable',
          'report-calculation': emptySecurity,
        },
      });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*Could not verify/),
        expect.objectContaining({ db: '_users', error: 'unreadable response' }),
      );
      // the database after the unreadable one is still checked
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/empty _security document/),
        expect.objectContaining({ db: 'report-calculation' }),
      );
    });

    it('does not flag a database that refuses the _security read with 403 (not a member, so not open to anyone)', async () => {
      stubCouchdb({ securityByDb: { 'report-calculation': 403 } });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs CRITICAL on a 401, which means this service's own credentials were rejected rather than the database being restricted", async () => {
      stubCouchdb({ securityByDb: { 'report-calculation': 401 } });
      const service = buildService();

      await service.runSecurityChecks();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/CRITICAL.*Could not verify/),
        expect.objectContaining({ db: 'report-calculation', status: 401 }),
      );
    });

    it('logs "could not verify" instead of failing when /_all_dbs is forbidden', async () => {
      stubCouchdb({ allDbsResult: 'forbidden' });
      const service = buildService();

      await service.runSecurityChecks();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Could not verify whether any CouchDB database has an open _security document',
        ),
        expect.anything(),
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
