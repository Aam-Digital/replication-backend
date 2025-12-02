import { Injectable, Logger } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { Permission, RulesConfig } from './permission';
import { catchError, concatMap, defer, of, repeat, retry } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { ConfigService } from '@nestjs/config';
import { ChangesResponse } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/changes.dto';
import { get, has } from 'lodash';
import { AdminService } from '../../admin/admin.service';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService {
  static readonly ENV_PERMISSION_DB = 'PERMISSION_DB';
  static readonly USER_PROPERTY_UNDEFINED = '__USER_PROPERTY_UNDEFINED__';

  private readonly logger = new Logger(RulesService.name);
  private permission: RulesConfig;
  private lastSeq: string;

  constructor(
    private couchdbService: CouchdbService,
    private configService: ConfigService,
    private adminService: AdminService,
  ) {
    const permissionDbName = this.configService.get(
      RulesService.ENV_PERMISSION_DB,
    );
    this.loadRulesContinuously(permissionDbName);
  }

  loadRulesContinuously(db = 'app') {
    // Rebuild params when observable is retried/repeated
    const getParams = defer(() =>
      of({
        filter: '_doc_ids',
        feed: 'longpoll',
        limit: '1',
        since: this.lastSeq,
        include_docs: true,
        doc_ids: JSON.stringify([Permission.DOC_ID]),
        // requests somehow time out after 1 minute
        timeout: 50000,
      }),
    );

    return getParams
      .pipe(
        concatMap((params) =>
          this.couchdbService.get<ChangesResponse>(db, '_changes', params),
        ),
        catchError((err) => {
          this.logger.error('LOAD RULES ERROR:', err);
          throw err;
        }),
        retry({ delay: 1000 }),
        repeat(),
      )
      .subscribe((changes) => {
        this.lastSeq = changes.last_seq;
        if (changes.results?.length > 0) {
          const prevPermissions = this.permission;
          const newPermissions = changes.results[0].doc.data;

          this.permission = newPermissions;

          if (
            prevPermissions !== undefined && // do not clear upon restart of the API
            JSON.stringify(prevPermissions) !== JSON.stringify(newPermissions)
          ) {
            setTimeout(
              () =>
                this.adminService.clearLocal(db).then(() => {
                  this.logger.log(
                    'Permissions changed - triggered clearLocal:' + db,
                  );
                }),
              1000,
            );
          }
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
