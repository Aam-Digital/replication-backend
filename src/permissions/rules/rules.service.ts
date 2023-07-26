import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { Permission, RulesConfig } from './permission';
import { catchError, concatMap, defer, of, repeat, retry, tap } from 'rxjs';
import * as _ from 'lodash';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { ConfigService } from '@nestjs/config';
import { ChangesResponse } from '../../restricted-endpoints/replication/replication-endpoints/couchdb-dtos/changes.dto';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService {
  static readonly ENV_PERMISSION_DB = 'PERMISSION_DB';
  private permission: RulesConfig;
  private lastSeq: string;

  constructor(
    private couchdbService: CouchdbService,
    private configService: ConfigService,
  ) {
    const permissionDbName = this.configService.get(
      RulesService.ENV_PERMISSION_DB,
    );
    this.loadRulesContinuously(permissionDbName).subscribe();
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
      }),
    );

    return getParams.pipe(
      concatMap((params) =>
        this.couchdbService.get<ChangesResponse>(db, '_changes', params),
      ),
      tap((changes) => {
        this.lastSeq = changes.last_seq;
        if (changes.results.length > 0) {
          this.permission = changes.results[0].doc.data;
        }
      }),
      catchError((err) => {
        console.error('LOAD RULES ERROR:', err);
        throw err;
      }),
      retry({ delay: 1000 }),
      repeat(),
    );
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

  private injectUserVariablesIntoRules(rules: DocumentRule[], user: UserInfo) {
    return JSON.parse(JSON.stringify(rules), (that, rawValue) => {
      if (rawValue[0] !== '$') {
        return rawValue;
      }

      const name = rawValue.slice(2, -1);
      const value = _.get({ user }, name);

      if (typeof value === 'undefined') {
        throw new ReferenceError(`Variable ${name} is not defined`);
      }

      return value;
    });
  }
}
