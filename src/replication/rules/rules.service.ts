import { Injectable } from '@nestjs/common';
import { RawRule } from '@casl/ability';

@Injectable()
export class RulesService {
  rules: Map<string, RawRule[]>;
  initRules() {
    // TODO read from database
    this.rules = new Map<string, RawRule[]>();
  }

  getRulesForRoles(roles: string[]): RawRule[] {
    return roles.map((role) => this.rules.get(role)).flat();
  }
}
