import { Injectable } from '@nestjs/common';
import { User } from '../../session/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';
import { Ability, InferSubjects } from '@casl/ability';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';

const actions = [
  'read',
  'write',  // Could be replaced with more granular distinction (create,update,delete)
  'manage', // Matches any actions
] as const;

type Actions = typeof actions[number];
type Subjects = InferSubjects<typeof DatabaseDocument> | string;
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
