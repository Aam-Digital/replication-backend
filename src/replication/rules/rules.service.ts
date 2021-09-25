import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { User } from '../../session/session/user-auth.dto';
import * as Rules from '../../assets/rules.json';

export type DocumentRule = RawRuleOf<DocumentAbility>;

/**
 * Service that manages the set of rules for the current instance.
 * The format of the rules is derived from CASL, see {@link https://casl.js.org/v5/en/guide/define-rules#json-objects}
 */
@Injectable()
export class RulesService {
  private rules = new Map<string, DocumentRule[]>();

  constructor() {
    Object.keys(Rules).forEach((key) => this.rules.set(key, Rules[key]));
  }

  /**
   * Get all rules that are related to the roles of the user
   * @param user for which the rules should be retrieved
   * @returns DocumentRule[] rules that are related to the user
   */
  getRulesForUser(user: User): DocumentRule[] {
    return user.roles.map((role) => this.rules.get(role)).flat();
  }
}
