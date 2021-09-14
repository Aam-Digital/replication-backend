import { Injectable } from '@nestjs/common';
import { RawRuleOf } from '@casl/ability';
import { DocumentAbility } from '../permission/permission.service';
import { User } from '../../session/session/user-auth.dto';

export type DocumentRule = RawRuleOf<DocumentAbility>;

@Injectable()
export class RulesService {
  rules: Map<string, DocumentRule[]>;
  initRules() {
    // TODO read from database
    // TODO what to do if no rules are defined? -> allow everything?
    this.rules = new Map<string, DocumentRule[]>();
  }

  getRulesForUser(user: User): DocumentRule[] {
    return user.roles.map((role) => this.rules.get(role)).flat();
  }
}
