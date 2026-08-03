import { RawRuleOf } from '@casl/ability';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { get, has } from 'lodash';
import {
  catchError,
  concatMap,
  EMPTY,
  filter,
  firstValueFrom,
  retry,
  Subject,
  throwError,
  timer,
} from 'rxjs';
import { AdminService } from '../../admin/admin.service';
import { ExponentialBackoff } from '../../common/exponential-backoff';
import { isLikelyTransientError } from '../../common/http-error-classification';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { DocumentAbility } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import {
  mergeManagedDefaults,
  SYSTEM_DEFAULT_MARKER,
} from './default-permissions';
import {
  ADMIN_APP_ROLE,
  DEFAULT_SECTION_KEY,
  LEGACY_DEFAULT_KEY,
  LEGACY_SECTION_KEYS,
  Permission,
  PUBLIC_SECTION_KEY,
  RESERVED_ROLE_PREFIX,
  RESERVED_RULE_CONFIG_KEYS,
  RulesConfig,
} from './permission';
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
   * Retries for an on-demand permission-document fetch (triggered by the
   * changes feed) before falling back to the previous in-memory config.
   */
  static readonly UPDATE_FETCH_MAX_RETRIES = 3;

  /**
   * Synthesised permission config used when the permission document does not
   * exist yet (e.g. fresh install). Only `admin_app` users get full access so
   * an administrator can sign in and seed the real config; all other users
   * (and anonymous traffic) are denied by default.
   */
  private static bootstrapPermissions(): RulesConfig {
    return { [ADMIN_APP_ROLE]: [{ action: 'manage', subject: 'all' }] };
  }

  private readonly logger = new Logger(RulesService.name);
  private permission!: RulesConfig;
  private readonly permissionsChanged = new Subject<void>();

  /**
   * Emits whenever the in-memory permission config actually changed, so that
   * consumers (e.g. PermissionService) can discard data derived from it.
   *
   * Deliberately not emitted for the initial load during {@link onModuleInit}:
   * no request has been served at that point, so there is nothing derived to
   * invalidate yet.
   */
  readonly permissionsChanged$ = this.permissionsChanged.asObservable();

  /**
   * Single write point for the in-memory config. Legacy section keys are
   * normalized onto their current spelling here, so every read path only has to
   * know about {@link DEFAULT_SECTION_KEY} and {@link PUBLIC_SECTION_KEY}.
   */
  private setPermission(config: RulesConfig): void {
    this.permission = RulesService.normalizeSectionKeys(config);
  }

  /**
   * Move rules stored under a legacy section key onto the current key. The
   * current key wins if a config carries both, matching the write-back in
   * {@link writeManagedDefaults} that drops the legacy one.
   */
  private static normalizeSectionKeys(config: RulesConfig): RulesConfig {
    const legacyKeys = Object.keys(LEGACY_SECTION_KEYS).filter(
      (key) => config[key] !== undefined,
    );
    if (legacyKeys.length === 0) {
      return config;
    }
    const normalized = { ...config };
    for (const legacyKey of legacyKeys) {
      const currentKey = LEGACY_SECTION_KEYS[legacyKey];
      normalized[currentKey] = normalized[currentKey] ?? normalized[legacyKey];
      delete normalized[legacyKey];
    }
    return normalized;
  }

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
          this.setPermission(data);
        }
        await this.ensureManagedDefaults(db, permissionDoc);
        return;
      } catch (error) {
        if (error instanceof HttpException && error.getStatus() === 404) {
          this.enterBootstrapMode(db);
          return;
        }
        lastError = error;
        const delay = backoff.recordFailure();
        const isTransient = isLikelyTransientError(error);
        const message = 'Failed to load initial permissions; retrying.';
        const logContext = {
          db,
          retryDelayMs: delay,
          isTransient,
          lastError: error instanceof Error ? error.message : String(error),
        };
        if (isTransient) {
          this.logger.log(message, logContext);
        } else {
          this.logger.warn(message, logContext);
        }
      }

      // The change feed may have populated `this.permission` while we were
      // waiting for the HTTP response — exit early if so.
      if (await this.waitForNextRetry(backoff.currentDelay)) {
        return;
      }
    }

    this.logger.error(
      'CRITICAL: gave up loading initial permissions. Aborting startup.',
      { db, timeoutMs: RulesService.INIT_MAX_TOTAL_MS },
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
      this.setPermission(RulesService.bootstrapPermissions());
    }
    this.logger.warn(
      '[PERMISSIONS_BOOTSTRAP_MODE] BOOTSTRAP MODE: no permission document found. ' +
        'Granting full access to admin_app users only until the real permission config is created. ' +
        'All other users are denied. ' +
        'Startup continued with bootstrap permissions. ' +
        'If this instance is not in first-time setup, treat this as a possible misconfiguration ' +
        '(check PERMISSION_DB, DATABASE_URL, and reverse proxy routing).',
      { db, document: Permission.DOC_ID },
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
    // The shared changes feed only delivers document IDs (no doc bodies, to
    // keep the constant background feed lightweight) — fetch the permission
    // document on demand when its ID shows up. concatMap serializes fetches
    // so rapid consecutive config updates cannot apply out of order.
    this.documentChangesService
      .getChanges(db)
      .pipe(
        filter((change) => change.id === Permission.DOC_ID),
        concatMap((change) => {
          if (change.deleted) {
            // the permission document was removed — fail closed to bootstrap
            // permissions instead of silently keeping the previous (possibly
            // permissive) in-memory rules
            this.applyPermissionDeletion(db);
            return EMPTY;
          }
          return this.couchdbService
            .get<Permission>(db, Permission.DOC_ID)
            .pipe(
              // a transient fetch failure must not silently drop the update —
              // retry with backoff before giving up (non-transient errors are
              // rethrown immediately and handled by catchError below)
              retry({
                count: RulesService.UPDATE_FETCH_MAX_RETRIES,
                delay: (error: unknown, retryCount: number) => {
                  if (!isLikelyTransientError(error)) {
                    return throwError(() => error);
                  }
                  const delayMs = Math.min(
                    1000 * 2 ** (retryCount - 1),
                    RulesService.INIT_MAX_DELAY_MS,
                  );
                  this.logger.log('Retrying permission document fetch', {
                    db,
                    attempt: retryCount,
                    retryDelayMs: delayMs,
                  });
                  return timer(delayMs);
                },
              }),
              catchError((error: unknown) => {
                this.logger.warn(
                  'Failed to fetch updated permission document after retries; keeping previous in-memory permissions.',
                  {
                    db,
                    error: error instanceof Error ? error.stack : String(error),
                  },
                );
                return EMPTY;
              }),
            );
        }),
      )
      .subscribe((permissionDoc) =>
        this.applyUpdatedPermission(db, permissionDoc),
      );
  }

  private applyUpdatedPermission(db: string, permissionDoc: Permission): void {
    const prevPermissions = this.permission;
    const newPermissions = permissionDoc?.data;

    if (!PermissionConfigValidator.isValidRulesConfig(newPermissions)) {
      this.logger.warn(
        'Permissions change did not contain valid data; keeping previous in-memory permissions.',
        { db },
      );
      return;
    }

    this.setPermission(newPermissions);
    // compare the normalized configs: migrating a legacy section key is not a
    // rule change and must not trigger a cache clear / client re-sync
    this.onPermissionsChanged(db, prevPermissions, this.permission);
    void this.ensureManagedDefaults(db, permissionDoc);
  }

  /**
   * The permission document was deleted — fail closed by switching to the
   * bootstrap config (admin_app only), so a removed config cannot leave the
   * previous, more permissive rules in effect.
   */
  private applyPermissionDeletion(db: string): void {
    this.logger.warn(
      '[PERMISSIONS] Permission document was deleted; failing closed to bootstrap permissions (admin_app only).',
      { db, document: Permission.DOC_ID },
    );
    const prevPermissions = this.permission;
    const bootstrap = RulesService.bootstrapPermissions();
    this.setPermission(bootstrap);
    this.onPermissionsChanged(db, prevPermissions, bootstrap);
  }

  /**
   * Invalidate caches and re-trigger client sync when the in-memory permission
   * config actually changed (shared by config-update and config-deletion).
   */
  private onPermissionsChanged(
    db: string,
    prevPermissions: RulesConfig | undefined,
    newPermissions: RulesConfig,
  ): void {
    if (
      prevPermissions === undefined || // do not clear upon restart of the API
      JSON.stringify(prevPermissions) === JSON.stringify(newPermissions)
    ) {
      return;
    }
    this.permissionsChanged.next();
    this.userIdentityService.clearCache();
    setTimeout(
      () =>
        this.adminService
          .clearLocal(db)
          .then(() => {
            this.logger.log('Permissions changed - triggered clearLocal:' + db);
          })
          .catch((error: unknown) => {
            this.logger.error(
              'Failed to clear local docs after permission update',
              {
                db,
                error: error instanceof Error ? error.stack : String(error),
              },
            );
          }),
      1000,
      // a pending clearLocal must not keep the process alive on shutdown
    ).unref();
  }

  /**
   * Idempotently write the managed system-default rules into the `default`
   * section of the permission document (see {@link MANAGED_DEFAULT_RULES}).
   * Retries on rev conflicts with a freshly fetched doc so that concurrent
   * admin edits or multiple backend instances converge. Never throws: a
   * failed write-back must not break permission loading, and the next change
   * event triggers another attempt (self-healing).
   */
  private async ensureManagedDefaults(db: string, doc: Permission) {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const outcome = await this.writeManagedDefaults(db, doc, attempt === 2);
        if (outcome !== 'conflict') {
          return;
        }
        doc = await firstValueFrom(
          this.couchdbService.get<Permission>(db, Permission.DOC_ID),
        );
      }
    } catch (error) {
      // Belt-and-braces: this method must never throw, even if the merge
      // logic or the conflict re-fetch misbehaves; the next change event
      // triggers another attempt (self-healing).
      this.logger.error('Failed to write managed default permissions', {
        db,
        error: error instanceof Error ? error.stack : String(error),
      });
    }
  }

  /**
   * One write-back attempt: merge the managed defaults into the doc and PUT
   * it if anything changed. Returns "conflict" when the PUT hit a rev
   * conflict and retrying with a freshly fetched doc makes sense; rethrows
   * any other error for {@link ensureManagedDefaults} to log.
   */
  private async writeManagedDefaults(
    db: string,
    doc: Permission,
    isLastAttempt: boolean,
  ): Promise<'done' | 'conflict'> {
    if (!PermissionConfigValidator.isValidRulesConfig(doc?.data)) {
      return 'done';
    }
    const currentDefault =
      doc.data[DEFAULT_SECTION_KEY] ?? doc.data[LEGACY_DEFAULT_KEY];
    const hasLegacyDefault = doc.data[LEGACY_DEFAULT_KEY] !== undefined;
    const { merged, changed, dropped } = mergeManagedDefaults(currentDefault);
    // still rewrite when only migrating the legacy key across to the new one
    if (!changed && !hasLegacyDefault) {
      return 'done';
    }
    const newData = { ...doc.data, [DEFAULT_SECTION_KEY]: merged };
    delete newData[LEGACY_DEFAULT_KEY];
    const updatedDoc: Permission = { ...doc, data: newData };
    this.logger.debug(
      `Writing managed default permissions to "${db}" (rev ${doc._rev ?? 'none'})`,
    );
    try {
      await firstValueFrom(this.couchdbService.put(db, updatedDoc));
      if (dropped.length > 0) {
        // warn only after the write persisted, so a failed or conflicting
        // attempt does not falsely claim rules were replaced
        this.logger.warn(
          'Customized rule(s) carrying the system-default marker were replaced',
          { db, marker: SYSTEM_DEFAULT_MARKER, dropped },
        );
      }
      this.logger.log(
        `Managed default permissions written to "${Permission.DOC_ID}" in "${db}"`,
      );
      return 'done';
    } catch (error) {
      const isConflict =
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.CONFLICT;
      if (isConflict && !isLastAttempt) {
        this.logger.debug(
          `Failed to write managed default permissions to "${db}" due to rev conflict, retrying with fresh doc`,
        );
        return 'conflict';
      }
      throw error;
    }
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
      return this.permission?.[PUBLIC_SECTION_KEY] ?? [];
    }
    if (this.permission) {
      const userRules = user.roles
        .filter(
          // reserved section keys and any underscore-prefixed name carry
          // special semantics and never resolve as a user role; legacy keys are
          // already normalized away, they are listed to keep the guard explicit
          (role) =>
            !role.startsWith(RESERVED_ROLE_PREFIX) &&
            !RESERVED_RULE_CONFIG_KEYS.includes(role) &&
            PermissionConfigValidator.hasRole(this.permission, role),
        )
        .map((role) => this.permission[role])
        .filter((rules): rules is DocumentRule[] => rules !== undefined)
        .flat();
      const defaultRules = this.permission[DEFAULT_SECTION_KEY];
      if (defaultRules) {
        userRules.unshift(...defaultRules);
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
        this.logger.warn('Rule variable is not defined for user', {
          variable: name,
        });
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
