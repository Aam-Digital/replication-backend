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
    await this.ensureDatabasesExist(this.getPrimaryDbName());
    void this.runSecurityChecks();
  }

  /**
   * The checks below only ever log, and their cost grows with the number of
   * databases on the server, so they run detached instead of holding up the
   * port NestJS listens on. Returns a promise so tests can await them.
   */
  async runSecurityChecks(): Promise<void> {
    const primaryDb = this.getPrimaryDbName();
    try {
      await this.assertSecurityIsLockedDown(primaryDb);
      await this.warnIfJwtKeysConfigured();
      await this.warnIfAnyDatabaseSecurityIsOpenToAnyone(primaryDb);
    } catch (error) {
      // nothing is awaiting this, so an error escaping here would be an
      // unhandled rejection rather than a failed check
      this.logger.error(
        'CRITICAL: CouchDB security invariant checks did not complete, so ' +
          'they are inconclusive.',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
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

  private static readonly OPEN_TO_ANYONE_MESSAGE =
    'CRITICAL: CouchDB database has an empty _security document, ' +
    'which CouchDB treats as open to any client it accepts - not ' +
    'admin-only. Fix: PUT a _security document that restricts ' +
    "members to CouchDB's reserved `_admin` role. Continuing startup.";

  private static readonly NOT_ADMIN_ONLY_MESSAGE =
    'CRITICAL: CouchDB database has a non-admin-only _security ' +
    'document - any client CouchDB itself accepts can bypass ' +
    'every permission check this service performs. Fix: PUT a ' +
    "_security document that restricts members to CouchDB's " +
    'reserved `_admin` role. Continuing startup.';

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
      const security = await this.readSecurity(db);
      if (
        !security ||
        CouchdbStartupInvariantsService.isSecurityLockedDown(security)
      ) {
        continue;
      }
      this.logInsecureSecurity(
        db,
        security,
        CouchdbStartupInvariantsService.isOpenToAnyone(security)
          ? CouchdbStartupInvariantsService.OPEN_TO_ANYONE_MESSAGE
          : CouchdbStartupInvariantsService.NOT_ADMIN_ONLY_MESSAGE,
      );
    }
  }

  /**
   * @param refusalIsConclusive whether being refused already answers the
   *   caller's question rather than leaving it open - see {@link isNotAMember}
   * @returns the database's `_security`, or undefined if there is nothing
   *   left for the caller to check - a read that failed inconclusively is
   *   logged as CRITICAL here
   */
  private async readSecurity(
    db: string,
    { refusalIsConclusive = false } = {},
  ): Promise<CouchdbSecurityDoc | undefined> {
    try {
      return await firstValueFrom(
        this.couchdbService.get<CouchdbSecurityDoc>(db, '_security'),
      );
    } catch (error) {
      if (
        refusalIsConclusive &&
        CouchdbStartupInvariantsService.isNotAMember(error)
      ) {
        return undefined;
      }
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
      return undefined;
    }
  }

  private logInsecureSecurity(
    db: string,
    security: CouchdbSecurityDoc,
    message: string,
  ): void {
    this.logger.error(message, {
      db,
      security,
      fixCommand:
        `curl -X PUT $COUCHDB_URL/${db}/_security -d ` +
        `'{"admins":{"names":[],"roles":["_admin"]},"members":{"names":[],"roles":["_admin"]}}'`,
    });
  }

  /**
   * CouchDB hands a database's `_security` to any client it accepts while
   * `members` is empty, and only to a member once it isn't - so a 403 proves
   * the database is not open to anyone, which is exactly what
   * {@link isOpenToAnyone} looks for. Deliberately not 401: that one means
   * CouchDB rejected this service's own credentials and says nothing about
   * the database.
   */
  private static isNotAMember(error: unknown): boolean {
    return (
      error instanceof HttpException &&
      error.getStatus() === HttpStatus.FORBIDDEN
    );
  }

  private static isEmptyList(arr: string[] | undefined): boolean {
    return !arr || arr.length === 0;
  }

  /** CouchDB treats an empty `members` list as no restriction, not as admin-only. */
  private static isOpenToAnyone(
    security: CouchdbSecurityDoc | undefined,
  ): boolean {
    return (
      CouchdbStartupInvariantsService.isEmptyList(security?.members?.names) &&
      CouchdbStartupInvariantsService.isEmptyList(security?.members?.roles)
    );
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

  /**
   * `assertSecurityIsLockedDown` above only knows the primary databases by
   * name. CouchDB persists its `[couchdb] default_security` fallback into a
   * database's actual `_security` document the first time the database is
   * initialized with none set (`couch_bt_engine:set_default_security_object/4`),
   * so a database that never had an explicit `_security` PUT - `_users`,
   * `report-calculation`, `notification-webhook` in this stack - still ends
   * up with a real, readable `_admin`-locked document once created under a
   * default-`admin_only` CouchDB 3. A genuinely open one (`default_security`
   * overridden, or a database whose security predates that CouchDB 3
   * behavior) still persists as empty, so the same `isOpenToAnyone` check
   * used above still catches it. `GET /_all_dbs` finds every database on the
   * server, not just the ones this service creates, so that check runs here
   * against all of them. Only that weaker check: a database this service
   * doesn't own may legitimately grant members of its own, whereas being
   * readable by anyone is unsafe whichever component owns it. The primary
   * databases are skipped, since the stricter check above already covers
   * them and would otherwise double-log the same finding.
   *
   * `/_all_dbs` requires CouchDB server-admin credentials; without them this
   * logs the same "could not verify" warning as {@link warnIfJwtKeysConfigured}
   * and skips the check entirely, rather than risk a false CRITICAL. A single
   * database refusing the `_security` read is not inconclusive in the same
   * way - see {@link isNotAMember}.
   */
  private async warnIfAnyDatabaseSecurityIsOpenToAnyone(
    primaryDb: string,
  ): Promise<void> {
    let allDbs: string[];
    try {
      allDbs = await firstValueFrom(
        this.couchdbService.get<string[]>(undefined, '_all_dbs'),
      );
    } catch (error) {
      this.logger.warn(
        'Could not verify whether any CouchDB database has an open ' +
          '_security document (requires CouchDB server admin credentials); ' +
          'skipping this check.',
        {
          error: error instanceof Error ? error.message : String(error),
          status:
            error instanceof HttpException ? error.getStatus() : undefined,
        },
      );
      return;
    }

    const alreadyChecked = new Set([primaryDb, ATTACHMENTS_DB]);
    for (const db of allDbs.filter((db) => !alreadyChecked.has(db))) {
      const security = await this.readSecurity(db, {
        refusalIsConclusive: true,
      });
      if (
        security &&
        CouchdbStartupInvariantsService.isOpenToAnyone(security)
      ) {
        this.logInsecureSecurity(
          db,
          security,
          CouchdbStartupInvariantsService.OPEN_TO_ANYONE_MESSAGE,
        );
      }
    }
  }
}
