import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import { ConfigService } from '@nestjs/config';
import { Permission } from './permission';
import { catchError, map, Observable, of } from 'rxjs';
import { AxiosResponse } from 'axios';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService extends CouchDBInteracter {
  private rules: Permission;

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
        map((response) => (this.rules = response.data)),
      );
  }

  /**
   * Get all rules that are related to the roles of the user
   * @param user for which the rules should be retrieved
   * @returns DocumentRule[] rules that are related to the user
   */
  getRulesForUser(user: User): DocumentRule[] {
    if (this.rules && this.rules.rulesConfig) {
      return user.roles
        .filter((role) => this.rules.rulesConfig.hasOwnProperty(role))
        .map((role) => this.rules.rulesConfig[role])
        .flat();
    } else {
      return [{ subject: 'all', action: 'manage' }];
    }
  }
}
