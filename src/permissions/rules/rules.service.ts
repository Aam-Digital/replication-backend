import { RawRuleOf } from '@casl/ability';
import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { get, has } from 'lodash';
import { firstValueFrom } from 'rxjs';
import { AdminService } from '../../admin/admin.service';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { DocumentAbility } from '../permission/permission.service';
import { UserIdentityService } from '../user-identity/user-identity.service';
import { Permission, RulesConfig } from './permission';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService implements OnModuleInit {
  static readonly ENV_PERMISSION_DB = 'PERMISSION_DB';
  static readonly USER_PROPERTY_UNDEFINED = '__USER_PROPERTY_UNDEFINED__';

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
    try {
      const permissionDoc = await firstValueFrom(
        this.couchdbService.get<Permission>(db, Permission.DOC_ID),
      );

      // Do not overwrite permissions that may have arrived from the live feed already.
      if (this.permission === undefined) {
        this.permission = permissionDoc?.data;
      }
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getStatus() === 401 || error.getStatus() === 403)
      ) {
        this.logger.error(
          `CRITICAL: CouchDB rejected the configured credentials when loading initial permissions from "${db}". ` +
            `Verify DATABASE_USER, DATABASE_PASSWORD and DATABASE_URL match the CouchDB the service is connecting to. ` +
            `Aborting startup.`,
        );
        throw error;
      }
      this.logger.warn(
        `Failed to load initial permissions from ${db}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private watchPermissionChanges(db = 'app') {
    this.documentChangesService.getChanges(db).subscribe((change) => {
      if (change.id !== Permission.DOC_ID) {
        return;
      }

      const prevPermissions = this.permission;
      const newPermissions = change.doc?.data;

      if (!newPermissions || typeof newPermissions !== 'object') {
        this.logger.warn(
          `Permissions change for ${db} did not contain valid data; keeping previous in-memory permissions.`,
        );
        return;
      }

      this.permission = newPermissions as RulesConfig;

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
   * Get all rules that are related to the roles of the user
   * If no permissions are found, returns rule that allows everything
   * @param user for which the rules should be retrieved
   * @returns DocumentRule[] rules that are related to the user
   */
  getRulesForUser(user: UserInfo): DocumentRule[] {
    if (!user) {
      return this.permission?.public ?? [];
    }
    if (this.permission) {
      const userRules = user.roles
        .filter((role) => this.permission.hasOwnProperty(role))
        .map((role) => this.permission[role])
        .filter((rules): rules is DocumentRule[] => rules !== undefined)
        .flat();
      if (this.permission.default) {
        userRules.unshift(...this.permission.default);
      }
      return this.injectUserVariablesIntoRules(userRules, user);
    } else {
      return [{ subject: 'all', action: 'manage' }];
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
