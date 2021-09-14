import { Injectable } from '@nestjs/common';
import { User } from '../../session/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';
import { Ability, InferSubjects } from '@casl/ability';
import { Action } from '../rules/action';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';

export type Actions = Action[number];
export type Subjects = InferSubjects<typeof DatabaseDocument> | string;
export type DocumentAbility = Ability<[Actions, Subjects]>;

@Injectable()
export class PermissionService {
  constructor(private rulesService: RulesService) {}

  getAbilityFor(user: User): DocumentAbility {
    const rules = this.rulesService.getRulesForUser(user);
    return new Ability<[Actions, Subjects]>(rules, {
      detectSubjectType: (subject) => {
        if (subject instanceof String) {
          return subject;
        } else {
          return subject._id.split(':')[0] as any;
        }
      },
    });
  }
}
