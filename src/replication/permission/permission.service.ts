import { Injectable } from '@nestjs/common';
import { User } from '../../session/session/user-auth.dto';
import { DocumentRule, RulesService } from '../rules/rules.service';
import { Ability, InferSubjects } from '@casl/ability';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';

const actions = [
  'read',
  'create',
  'update',
  'delete',
  'manage', // Matches any actions
] as const;

type Actions = typeof actions[number];
type Subjects = InferSubjects<typeof DatabaseDocument> | string;
export type DocumentAbility = Ability<[Actions, Subjects]>;

/**
 * Service that creates ability objects which can be used to check permissions.
 *
 * For more information about the abilities check the CASL docs {@link https://casl.js.org/v5/en/guide/intro}
 */
@Injectable()
export class PermissionService {
  private readonly permissionWriteRestriction: DocumentRule = {
    subject: 'Permission',
    action: ['create', 'update', 'delete'],
    inverted: true,
  };
  constructor(private rulesService: RulesService) {}

  /**
   * Creates an ability object containing all rules that are defined for the roles of the given user.
   * This ability object can be used to check the permissions of the user on various documents.
   *
   * @param user for which the ability object should be created
   * @returns DocumentAbility that allows to check the users permissions on a given document and action
   */
  getAbilityFor(user: User): DocumentAbility {
    const rules = this.rulesService
      .getRulesForUser(user)
      .concat(this.permissionWriteRestriction);
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
