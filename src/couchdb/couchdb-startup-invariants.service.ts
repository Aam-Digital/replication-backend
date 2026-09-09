import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { RulesService } from '../permissions/rules/rules.service';
import { CouchdbService } from './couchdb.service';

interface CouchdbSecurityDoc {
  admins?: { names?: string[]; roles?: string[] };
  members?: { names?: string[]; roles?: string[] };
}

/** the literal db name used for attachment documents throughout the codebase (see PermissionService) */
const ATTACHMENTS_DB = 'app-attachments';

/**
 * Asserts, at startup, invariants this service's whole security model relies
 * on but that live in CouchDB's configuration rather than this codebase - so
 * a change made directly against CouchDB (or a deployment script that never
 * got updated for this service) can silently invalidate them.
 *
 * This service is the only intended door to the databases it protects: every
 * client here authenticates against it (basic auth, or a bearer JWT it
 * verifies itself), and CouchDB's own auth is expected to stay admin-only.
 * These checks *assert* that, they never *mutate* CouchDB's config - the
 * config is owned by whatever deployment tooling writes it (ndb-setup /
 * Helm), and re-applying or removing it here would fight that tooling on
 * every restart. See the class-level docs in the individual check methods
 * for what each one guards against.
 */
@Injectable()
export class CouchdbStartupInvariantsService implements OnModuleInit {
  private readonly logger = new Logger(CouchdbStartupInvariantsService.name);

  constructor(
    private readonly couchdbService: CouchdbService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const primaryDb = this.getPrimaryDbName();
    await this.ensureDatabasesExist(primaryDb);
    await this.assertSecurityIsAdminOnly(primaryDb);
    await this.warnIfJwtKeysConfigured();
  }

  private getPrimaryDbName(): string {
    return (
      this.configService.get<string>(RulesService.ENV_PERMISSION_DB) ?? 'app'
    );
  }

  /**
   * Creates the databases this service depends on if they do not exist yet.
   * Idempotent (createDb resolves successfully if the database is already
   * there) - this only helps a fresh install; an existing, misconfigured
   * database is caught by {@link assertSecurityIsAdminOnly} below.
   */
  private async ensureDatabasesExist(primaryDb: string): Promise<void> {
    for (const db of [primaryDb, ATTACHMENTS_DB]) {
      await firstValueFrom(this.couchdbService.createDb(db));
    }
  }

  /**
   * Flags it if either database's `_security` grants access beyond the
   * CouchDB admin. This is the direct bypass the issue this service exists
   * to close: with a permissive `_security` (the "database-only" deployment
   * mode's `{"members": {"roles": ["user_app"]}}`), any client holding a
   * valid CouchDB session or a JWT CouchDB itself accepts can read and write
   * the database directly, skipping every permission check this service
   * performs entirely.
   *
   * This guards a real transition, not just a one-off misconfiguration: a
   * database that ever ran in database-only mode has this _security document
   * written, and nothing removes it when the deployment later switches to
   * running this service in front of CouchDB.
   * This logs CRITICAL rather than fail closed - a legacy setup may have its
   * own reason for a permissive _security, and aborting startup on it would
   * turn a routine version upgrade into an outage. See warnIfJwtKeysConfigured
   * below for the same reasoning applied to a related latent bypass.
   */
  private async assertSecurityIsAdminOnly(primaryDb: string): Promise<void> {
    for (const db of [primaryDb, ATTACHMENTS_DB]) {
      const security = await firstValueFrom(
        this.couchdbService.get<CouchdbSecurityDoc>(db, '_security'),
      );
      if (CouchdbStartupInvariantsService.isAdminOnly(security)) {
        continue;
      }
      this.logger.error(
        'CRITICAL: CouchDB database has a non-admin-only _security document, ' +
          'but this service expects to be the only door to it - a permissive ' +
          '_security lets any client CouchDB itself accepts bypass every ' +
          'permission check this service performs. This is expected on a ' +
          'database that ever ran in database-only mode (create-couchdb.sh ' +
          'applies {"members":{"roles":["user_app"]}} there and never clears ' +
          "it). Fix: PUT an empty _security document to reset it to CouchDB's " +
          'admin-only default. Continuing startup.',
        {
          db,
          security,
          fixCommand:
            `curl -X PUT $COUCHDB_URL/${db}/_security -d ` +
            `'{"admins":{"names":[],"roles":[]},"members":{"names":[],"roles":[]}}'`,
        },
      );
    }
  }

  private static isAdminOnly(
    security: CouchdbSecurityDoc | undefined,
  ): boolean {
    const isEmpty = (arr: string[] | undefined) => !arr || arr.length === 0;
    return (
      isEmpty(security?.admins?.names) &&
      isEmpty(security?.admins?.roles) &&
      isEmpty(security?.members?.names) &&
      isEmpty(security?.members?.roles)
    );
  }

  /**
   * CouchDB's `jwt_authentication_handler` + a populated `[jwt_keys]` section
   * let a bearer JWT authenticate directly against CouchDB. Nothing needs
   * that in a permission-checked deployment - this service, aam-services, SQS
   * and the deployment's setup step all use basic auth - so it is dead
   * config here, unlike in a database-only deployment where the browser
   * talks to CouchDB directly and needs it.
   *
   * Dead config is a latent risk, not a live bypass, given `_security` is
   * admin-only (asserted above): authenticating via JWT does not itself
   * grant `_security` access. But it stops being just latent the moment a
   * realm role happens to be named `_admin` - Keycloak's realm-role mapper
   * copies realm roles onto the `_couchdb.roles` claim verbatim, and CouchDB
   * treats a `_couchdb.roles` entry of exactly `_admin` as a *server* admin,
   * at which point `_security` no longer applies to that user at all. So
   * this logs CRITICAL rather than fail closed - see the issue for why
   * failing closed here (or worse, this service reaching into CouchDB's
   * config to remove it) would fight the deployment tooling that owns this
   * setting.
   */
  private async warnIfJwtKeysConfigured(): Promise<void> {
    let jwtKeys: Record<string, string>;
    try {
      jwtKeys = await firstValueFrom(
        this.couchdbService.get<Record<string, string>>(
          '_node/_local/_config',
          'jwt_keys',
        ),
      );
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.NOT_FOUND
      ) {
        return; // confirmed: no jwt_keys section configured
      }
      // GET /_node/_local/_config/jwt_keys requires CouchDB *server* admin,
      // which this service's documented requirement (member/admin on its
      // databases) does not guarantee against a managed CouchDB - report
      // "could not verify" rather than block startup on an inconclusive check.
      this.logger.warn(
        'Could not verify whether CouchDB has jwt_keys configured (requires CouchDB server admin credentials); skipping this check.',
        {
          error: error instanceof Error ? error.message : String(error),
          status:
            error instanceof HttpException ? error.getStatus() : undefined,
        },
      );
      return;
    }

    if (jwtKeys && Object.keys(jwtKeys).length > 0) {
      this.logger.error(
        'CRITICAL: CouchDB has [jwt_keys] configured. This is dead config in ' +
          'this (permission-checked) deployment mode and should be removed from ' +
          "CouchDB's config, along with jwt_authentication_handler from " +
          'authentication_handlers - see the class docs on ' +
          'CouchdbStartupInvariantsService.warnIfJwtKeysConfigured for why this ' +
          'is worth removing rather than leaving in place. Continuing startup.',
        { configuredKeyIds: Object.keys(jwtKeys) },
      );
    }
  }
}
