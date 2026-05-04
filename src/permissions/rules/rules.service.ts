import { RawRuleOf } from '@casl/ability';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { get, has } from 'lodash';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '../../admin/admin.service';
import { ExponentialBackoff } from '../../common/exponential-backoff';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { DocumentAbility } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { Permission, RulesConfig } from './permission';
import { PermissionConfigValidator } from './permission-config.validator';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService implements OnModuleInit {
  static readonly ENV_PERMISSION_DB = 'PERMISSION_DB';
  static readonly USER_PROPERTY_UNDEFINED = '__USER_PROPERTY_UNDEFINED__';

  /**
   * Maximum total time (ms) to keep retrying a transient initial load failure
   * before giving up and aborting startup.
   */
  static readonly INIT_MAX_TOTAL_MS = 60_000;
  /** Cap (ms) for the exponentially-growing backoff delay between retries. */
  static readonly INIT_MAX_DELAY_MS = 10_000;

  /**
   * Synthesised permission config used when the permission document does not
   * exist yet (e.g. fresh install). Only `admin_app` users get full access so
   * an administrator can sign in and seed the real config; all other users
   * (and anonymous traffic) are denied by default.
   */
  private static bootstrapPermissions(): RulesConfig {
    return { admin_app: [{ action: 'manage', subject: 'all' }] };
  }

  private readonly logger = new Logger(RulesService.name);
  private permission!: RulesConfig;

  constructor(
    private configService: ConfigService,
    private adminService: AdminService,
    private userIdentityService: UserIdentityService,
    private couchdbService: CouchdbService,
    private documentChangesService: DocumentChangesService,
  ) {}

  async onModuleInit(): Promise<void> {
    const permissionDbName = this.configService.get(
      RulesService.ENV_PERMISSION_DB,
    );
    this.watchPermissionChanges(permissionDbName);
    await this.loadInitialPermissions(permissionDbName);
  }

  private async loadInitialPermissions(db = 'app'): Promise<void> {
    const startedAt = Date.now();
    const backoff = new ExponentialBackoff({
      maxMs: RulesService.INIT_MAX_DELAY_MS,
    });
    let lastError: unknown;

    // Retry loop: keep trying until either we succeed, the permission doc is
    // confirmed missing (-> bootstrap), the live changes feed populates the
    // config for us, or the retry budget is exhausted.
    while (Date.now() - startedAt < RulesService.INIT_MAX_TOTAL_MS) {
      try {
        const permissionDoc = await firstValueFrom(
          this.couchdbService.get<Permission>(db, Permission.DOC_ID),
        );

        const data = permissionDoc?.data;
        if (!PermissionConfigValidator.isValidRulesConfig(data)) {
          throw new Error(
            `Permission document "${Permission.DOC_ID}" did not contain a valid configuration object`,
          );
        }

        // Do not overwrite permissions that may have arrived from the live feed already.
        if (this.permission === undefined) {
          this.permission = data;
        }
        return;
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 404) {
          this.enterBootstrapMode(db);
          return;
        }
        lastError = error;
        const delay = backoff.recordFailure();
        this.logger.warn(
          `Failed to load initial permissions from ${db} (will retry in ${delay}ms): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // The change feed may have populated `this.permission` while we were
      // waiting for the HTTP response — exit early if so.
      if (await this.waitForNextRetry(backoff.currentDelay)) {
        return;
      }
    }

    this.logger.error(
      `CRITICAL: gave up loading initial permissions from "${db}" after ${RulesService.INIT_MAX_TOTAL_MS}ms. Aborting startup.`,
    );
    throw lastError instanceof Error
      ? lastError
      : new Error(
          `Failed to load initial permissions from "${db}" within ${RulesService.INIT_MAX_TOTAL_MS}ms`,
        );
  }

  /**
   * Permission doc does not exist yet — typical on a fresh install before the
   * frontend seeds the initial config. Synthesize a config that grants admin
   * rights only to admin_app users so an administrator can sign in and create
   * the real config; the live changes feed will swap it in once it appears.
   */
  private enterBootstrapMode(db: string): void {
    if (this.permission === undefined) {
      this.permission = RulesService.bootstrapPermissions();
    }
    this.logger.warn(
      `[PERMISSIONS_BOOTSTRAP_MODE] BOOTSTRAP MODE: no permission document "${Permission.DOC_ID}" found in "${db}". ` +
        `Granting full access to admin_app users only until the real permission config is created. ` +
        `All other users are denied. ` +
        `Startup continued with bootstrap permissions. ` +
        `If this instance is not in first-time setup, treat this as a possible misconfiguration ` +
        `(check PERMISSION_DB, DATABASE_URL, and reverse proxy routing).`,
    );
  }

  private async waitForNextRetry(delay: number): Promise<boolean> {
    if (this.permission !== undefined) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    return this.permission !== undefined;
  }

  private watchPermissionChanges(db = 'app') {
    this.documentChangesService.getChanges(db).subscribe((change) => {
      if (change.id !== Permission.DOC_ID) {
        return;
      }

      const prevPermissions = this.permission;
      const newPermissions = change.doc?.data;

      if (!PermissionConfigValidator.isValidRulesConfig(newPermissions)) {
        this.logger.warn(
          `Permissions change for ${db} did not contain valid data; keeping previous in-memory permissions.`,
        );
        return;
      }

      this.permission = newPermissions;

      if (
        prevPermissions !== undefined && // do not clear upon restart of the API
        JSON.stringify(prevPermissions) !== JSON.stringify(newPermissions)
      ) {
        this.userIdentityService.clearCache();
        setTimeout(
          () =>
            this.adminService
              .clearLocal(db)
              .then(() => {
                this.logger.log(
                  'Permissions changed - triggered clearLocal:' + db,
                );
              })
              .catch((error: unknown) => {
                this.logger.error(
                  `Failed to clear local docs after permission update for ${db}`,
                  error instanceof Error ? error.stack : String(error),
                );
              }),
          1000,
        );
      }
    });
  }
  /**
   * Get all rules that are related to the roles of the user.
   *
   * Fail-closed: if no permission config has been loaded yet (which should be
   * unreachable because {@link onModuleInit} blocks startup until a config is
   * available — see issue #238), this returns an empty rule set so that CASL
   * denies every action. This is defense in depth against the historic
   * fail-open fallback that briefly granted full access to every authenticated
   * user when the permission doc was missing.
   *
   * @param user for which the rules should be retrieved
   * @returns DocumentRule[] rules that are related to the user
   */
  getRulesForUser(user: UserInfo): DocumentRule[] {
    if (!user) {
      return this.permission?.public ?? [];
    }
    if (this.permission) {
      const userRules = user.roles
        .filter((role) =>
          PermissionConfigValidator.hasRole(this.permission, role),
        )
        .map((role) => this.permission[role])
        .filter((rules): rules is DocumentRule[] => rules !== undefined)
        .flat();
      if (this.permission.default) {
        userRules.unshift(...this.permission.default);
      }
      return this.injectUserVariablesIntoRules(userRules, user);
    } else {
      this.logger.error(
        'getRulesForUser called before any permission config was loaded — denying all access. ' +
          'This indicates a bug: onModuleInit should block startup until permissions are available.',
      );
      return [];
    }
  }

  private injectUserVariablesIntoRules(
    rules: DocumentRule[],
    user: UserInfo,
  ): DocumentRule[] {
    return JSON.parse(JSON.stringify(rules), (that, rawValue) => {
      if (typeof rawValue !== 'string' || !rawValue.startsWith('$')) {
        return rawValue;
      }

      let name = rawValue.slice(2, -1);
      if (name === 'user.entityId') {
        // the user account related entity (assured with prefix) should get stored in user.entityId in the future
        // mapping the previously valid ${user.name} here for backward/forward compatibility
        name = 'user.name';
      }

      if (!has({ user }, name)) {
        // log instead of silent failure
        this.logger.warn(`Variable ${name} is not defined for user ${user.id}`);
        return RulesService.USER_PROPERTY_UNDEFINED;
      }

      const value = get({ user }, name);
      if (value === undefined) {
        // return placeholder instead of undefined to ensure conditions using this do not get ignored
        return RulesService.USER_PROPERTY_UNDEFINED;
      }

      return value;
    });
  }
}
