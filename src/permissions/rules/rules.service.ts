import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { COUCHDB_USER_DOC, User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import { ConfigService } from '@nestjs/config';
import { Permission } from './permission';
import { catchError, map, Observable, of } from 'rxjs';
import { AxiosResponse } from 'axios';
import * as _ from 'lodash';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService extends CouchDBInteracter {
  private readonly permissionEntityRules: DocumentRule[] = [
    {
      subject: 'Permission',
      action: ['create', 'update', 'delete'],
      inverted: true,
    },
    {
      subject: 'Permission',
      action: 'read',
    },
  ];
  private permission: Permission;

  constructor(httpService: HttpService, configService: ConfigService) {
    super(httpService, configService);
    this.loadRules();
  }

  loadRules(): Observable<Permission> {
    return this.httpService
      .get<Permission>(
        `${this.databaseUrl}/${this.databaseName}/${Permission.DOC_ID}`,
      )
      .pipe(
        catchError(() => of({ data: undefined } as AxiosResponse<Permission>)),
        map((response) => (this.permission = response.data)),
      );
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
    if (this.permission && this.permission.rulesConfig) {
      const userRules = user.roles
        .filter((role) => this.permission.rulesConfig.hasOwnProperty(role))
        .map((role) => this.permission.rulesConfig[role])
        .flat();
      return this.interpolateUser(userRules, user);
    } else {
      return [{ subject: 'all', action: 'manage' }];
    }
  }

  private getDefaultRules(user: User): DocumentRule[] {
    const presetRules: DocumentRule[] = [...this.permissionEntityRules];
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
        action: ['read', 'update'],
        conditions: { name: user.name },
      });
    }
    return presetRules;
  }

  private interpolateUser(rules: DocumentRule[], user: User) {
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
