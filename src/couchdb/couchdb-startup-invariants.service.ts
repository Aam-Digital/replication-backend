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
 * Asserts, at startup, security invariants this service relies on that live
 * in CouchDB's own configuration rather than in this codebase - so an
 * out-of-band config change can silently invalidate them. Only asserts,
 * never mutates: that config is owned by deployment tooling, not this
 * service.
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
    await this.assertSecurityIsLockedDown(primaryDb);
    await this.warnIfJwtKeysConfigured();
  }

  private getPrimaryDbName(): string {
    return (
      this.configService.get<string>(RulesService.ENV_PERMISSION_DB) ?? 'app'
    );
  }

  /** Idempotent; only helps a fresh install - an existing, misconfigured database is caught by {@link assertSecurityIsLockedDown} below. */
  private async ensureDatabasesExist(primaryDb: string): Promise<void> {
    for (const db of [primaryDb, ATTACHMENTS_DB]) {
      await firstValueFrom(this.couchdbService.createDb(db));
    }
  }

  /** CouchDB's reserved role for genuine server admins - never grantable to a regular user. */
  private static readonly ADMIN_ROLE = '_admin';

  /**
   * Flags it if either database's `_security` grants access beyond CouchDB
   * server admins - a permissive `_security` lets any client CouchDB itself
   * accepts read and write the database directly, bypassing every
   * permission check this service performs.
   *
   * Counterintuitively, an *empty* `_security` document is the worst case,
   * not the safe one: CouchDB treats an empty `members` list as no
   * restriction, not as admin-only. The one setting that actually means
   * "admins only" is restricting `members` to CouchDB's reserved `_admin`
   * role.
   *
   * Logs CRITICAL rather than failing closed, so a stale CouchDB config
   * doesn't turn a routine restart into an outage.
   */
  private async assertSecurityIsLockedDown(primaryDb: string): Promise<void> {
    for (const db of [primaryDb, ATTACHMENTS_DB]) {
      let security: CouchdbSecurityDoc;
      try {
        security = await firstValueFrom(
          this.couchdbService.get<CouchdbSecurityDoc>(db, '_security'),
        );
      } catch (error) {
        this.logger.error(
          'CRITICAL: Could not verify whether CouchDB database has a ' +
            'locked-down _security document. The response was unreadable, so ' +
            'this check is inconclusive. Continuing startup.',
          {
            db,
            error: error instanceof Error ? error.message : String(error),
            status:
              error instanceof HttpException ? error.getStatus() : undefined,
          },
        );
        continue;
      }
      if (CouchdbStartupInvariantsService.isSecurityLockedDown(security)) {
        continue;
      }
      const isOpenToAnyone =
        CouchdbStartupInvariantsService.isEmptyList(security?.members?.names) &&
        CouchdbStartupInvariantsService.isEmptyList(security?.members?.roles);
      this.logger.error(
        isOpenToAnyone
          ? 'CRITICAL: CouchDB database has an empty _security document, ' +
              'which CouchDB treats as open to any client it accepts - not ' +
              'admin-only. Fix: PUT a _security document that restricts ' +
              "members to CouchDB's reserved `_admin` role. Continuing " +
              'startup.'
          : 'CRITICAL: CouchDB database has a non-admin-only _security ' +
              'document - any client CouchDB itself accepts can bypass ' +
              'every permission check this service performs. Fix: PUT a ' +
              "_security document that restricts members to CouchDB's " +
              'reserved `_admin` role. Continuing startup.',
        {
          db,
          security,
          fixCommand:
            `curl -X PUT $COUCHDB_URL/${db}/_security -d ` +
            `'{"admins":{"names":[],"roles":["_admin"]},"members":{"names":[],"roles":["_admin"]}}'`,
        },
      );
    }
  }

  private static isEmptyList(arr: string[] | undefined): boolean {
    return !arr || arr.length === 0;
  }

  private static isSecurityLockedDown(
    security: CouchdbSecurityDoc | undefined,
  ): boolean {
    const isEmpty = CouchdbStartupInvariantsService.isEmptyList;
    const isExactlyAdminRole = (arr: string[] | undefined) =>
      !!arr &&
      arr.length === 1 &&
      arr[0] === CouchdbStartupInvariantsService.ADMIN_ROLE;
    // empty or exactly `_admin` are both safe here - neither grants anyone
    // beyond the server admins who already have full access regardless
    const isEmptyOrAdminRoleOnly = (arr: string[] | undefined) =>
      isEmpty(arr) || isExactlyAdminRole(arr);
    return (
      isEmpty(security?.admins?.names) &&
      isEmptyOrAdminRoleOnly(security?.admins?.roles) &&
      isEmpty(security?.members?.names) &&
      isExactlyAdminRole(security?.members?.roles)
    );
  }

  /**
   * Flags it if CouchDB has `[jwt_keys]` configured, which lets a bearer JWT
   * authenticate directly against CouchDB. Unused (dead config) in this
   * deployment mode, but if a Keycloak realm role is ever named `_admin` it
   * would grant CouchDB server-admin rights via JWT, bypassing `_security`
   * entirely. Logs CRITICAL rather than failing closed, for the same reason
   * as {@link assertSecurityIsLockedDown} above.
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
      // requires CouchDB *server* admin, which this service isn't guaranteed
      // to have against a managed CouchDB - report "could not verify"
      // rather than block startup on an inconclusive check
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
          'this deployment mode and should be removed, along with ' +
          'jwt_authentication_handler. Continuing startup.',
        { configuredKeyIds: Object.keys(jwtKeys) },
      );
    }
  }
}
