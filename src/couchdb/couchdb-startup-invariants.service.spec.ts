import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { RulesService } from '../permissions/rules/rules.service';
import { CouchdbStartupInvariantsService } from './couchdb-startup-invariants.service';
import { CouchdbService } from './couchdb.service';

function fakeHttpException(status: number): HttpException {
  return new HttpException({ error: 'fake' }, status);
}

describe('CouchdbStartupInvariantsService', () => {
  let couchdbService: jest.Mocked<Pick<CouchdbService, 'createDb' | 'get'>>;
  let configService: ConfigService;

  const emptySecurity = {
    admins: { names: [], roles: [] },
    members: { names: [], roles: [] },
  };

  beforeEach(() => {
    couchdbService = {
      createDb: jest.fn().mockReturnValue(of({ ok: true })),
      get: jest.fn(),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) } as any;
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

  /** default happy-path stub: admin-only security everywhere, no jwt_keys */
  function stubHappyPath() {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security') {
        return of(emptySecurity) as any;
      }
      if (db === '_node/_local/_config' && docId === 'jwt_keys') {
        return throwError(() => fakeHttpException(404)) as any;
      }
      return of(undefined) as any;
    });
  }

  it('creates the primary and attachments databases (idempotent)', async () => {
    stubHappyPath();
    const service = buildService();

    await service.onModuleInit();

    expect(couchdbService.createDb).toHaveBeenCalledWith('app');
    expect(couchdbService.createDb).toHaveBeenCalledWith('app-attachments');
  });

  it('uses PERMISSION_DB instead of the default "app" when configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) =>
      key === RulesService.ENV_PERMISSION_DB ? 'custom-db' : undefined,
    );
    stubHappyPath();
    const service = buildService();

    await service.onModuleInit();

    expect(couchdbService.createDb).toHaveBeenCalledWith('custom-db');
    expect(couchdbService.createDb).toHaveBeenCalledWith('app-attachments');
    expect(couchdbService.get).toHaveBeenCalledWith('custom-db', '_security');
  });

  it('does not throw when _security is empty/admin-only', async () => {
    stubHappyPath();
    const service = buildService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('does not throw and logs CRITICAL when the primary db has a permissive _security', async () => {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security' && db === 'app') {
        return of({
          admins: { names: [], roles: [] },
          members: { names: [], roles: ['user_app'] },
        }) as any;
      }
      if (docId === '_security') {
        return of(emptySecurity) as any;
      }
      return throwError(() => fakeHttpException(404)) as any;
    });
    const service = buildService();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-admin-only'),
      expect.objectContaining({ db: 'app' }),
    );
  });

  it('does not throw and logs CRITICAL when the attachments db has a permissive _security', async () => {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security' && db === 'app-attachments') {
        return of({
          admins: { names: [], roles: [] },
          members: { names: [], roles: ['user_app'] },
        }) as any;
      }
      if (docId === '_security') {
        return of(emptySecurity) as any;
      }
      return throwError(() => fakeHttpException(404)) as any;
    });
    const service = buildService();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('non-admin-only'),
      expect.objectContaining({ db: 'app-attachments' }),
    );
  });

  it('does not throw and logs CRITICAL when jwt_keys is configured', async () => {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security') {
        return of(emptySecurity) as any;
      }
      if (db === '_node/_local/_config' && docId === 'jwt_keys') {
        return of({ 'rsa:kid1': '-----BEGIN PUBLIC KEY-----...' }) as any;
      }
      return of(undefined) as any;
    });
    const service = buildService();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL'),
      expect.objectContaining({ configuredKeyIds: ['rsa:kid1'] }),
    );
  });

  it('does not throw and does not warn when jwt_keys is confirmed absent (404)', async () => {
    stubHappyPath();
    const service = buildService();
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await service.onModuleInit();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs "could not verify" instead of failing when the jwt_keys check is forbidden', async () => {
    couchdbService.get.mockImplementation((db?: string, docId?: string) => {
      if (docId === '_security') {
        return of(emptySecurity) as any;
      }
      if (db === '_node/_local/_config' && docId === 'jwt_keys') {
        return throwError(() => fakeHttpException(403)) as any;
      }
      return of(undefined) as any;
    });
    const service = buildService();
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not verify'),
      expect.anything(),
    );
  });
});
