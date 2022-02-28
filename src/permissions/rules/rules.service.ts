import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import {
  COUCHDB_USER_DOC,
  User,
} from '../../restricted-endpoints/session/user-auth.dto';
import { Permission, RulesConfig } from './permission';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import * as _ from 'lodash';
import { CouchdbService } from '../../restricted-endpoints/couchdb/couchdb.service';
import { ConfigService } from '@nestjs/config';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService {
  static readonly ENV_PERMISSION_DB = 'PERMISSION_DB';
  private readonly defaultRulesForEveryone: DocumentRule[] = [
    {
      subject: 'Permission',
      action: ['create', 'update', 'delete'],
      inverted: true,
    },
    {
      subject: 'Permission',
      action: 'read',
    },
    {
      subject: 'Config',
      action: ['create', 'update', 'delete'],
      inverted: true,
    },
    {
      subject: 'Config',
      action: 'read',
    },
    {
      subject: 'User',
      action: 'read',
    },
  ];
  private permission: RulesConfig;

  constructor(
    private couchdbService: CouchdbService,
    private configService: ConfigService,
  ) {
    // Somehow this only executes when it is subscribed to
    const permissionDbName = this.configService.get(
      RulesService.ENV_PERMISSION_DB,
    );
    this.loadRules(permissionDbName);
  }

  async loadRules(db: string): Promise<RulesConfig> {
    this.permission = await firstValueFrom(
      this.couchdbService.get<Permission>(db, Permission.DOC_ID).pipe(
        map((data) => data.rulesConfig),
        catchError(() => of(undefined)),
      ),
    );
    return this.permission;
  }

  /**
   * Get all rules that are related to the roles of the user
   * @param user for which the rules should be retrieved
   * @returns DocumentRule[] rules that are related to the user
   */
  getRulesForUser(user: User): DocumentRule[] {
    return this.getDBRules(user).concat(...this.getDefaultRules(user));
  }

  private getDBRules(user: User): DocumentRule[] {
    if (this.permission) {
      const userRules = user.roles
        .filter((role) => this.permission.hasOwnProperty(role))
        .map((role) => this.permission[role])
        .flat();
      return this.injectUserVariablesIntoRules(userRules, user);
    } else {
      return [{ subject: 'all', action: 'manage' }];
    }
  }

  private getDefaultRules(user: User): DocumentRule[] {
    const presetRules: DocumentRule[] = [...this.defaultRulesForEveryone];
    if (!user.roles.includes('_admin')) {
      // normal users can only read their own user object and update their password
      presetRules.push({
        subject: COUCHDB_USER_DOC,
        action: ['manage'],
        inverted: true,
      });
      presetRules.push({
        subject: COUCHDB_USER_DOC,
        action: 'read',
        conditions: { name: user.name },
      });
      presetRules.push({
        subject: COUCHDB_USER_DOC,
        action: 'update',
        fields: 'password',
        conditions: { name: user.name },
      });
      presetRules.push({
        subject: 'User',
        action: 'update',
        conditions: { name: user.name },
      });
    }
    return presetRules;
  }

  private injectUserVariablesIntoRules(rules: DocumentRule[], user: User) {
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
