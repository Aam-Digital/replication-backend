import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { User } from '../../session/session/user-auth.dto';
import * as Rules from '../../assets/rules.json';

export type DocumentRule = RawRuleOf<DocumentAbility>;

@Injectable()
export class RulesService {
  private rules = new Map<string, DocumentRule[]>();

  constructor() {
    Object.keys(Rules).forEach((key) => this.rules.set(key, Rules[key]));
  }

  getRulesForUser(user: User): DocumentRule[] {
    return user.roles.map((role) => this.rules.get(role)).flat();
  }
}
