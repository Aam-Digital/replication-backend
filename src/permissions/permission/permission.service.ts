import { Injectable } from '@nestjs/common';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';
import { Ability, AbilityClass, InferSubjects } from '@casl/ability';
import { DatabaseDocument } from '../../restricted-endpoints/replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';

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
export const DocumentAbility = Ability as AbilityClass<DocumentAbility>;

export function detectDocumentType(subject: DatabaseDocument): string {
  return subject._id.split(':')[0] as any;
}

/**
 * Service that creates ability objects which can be used to check permissions.
 *
 * For more information about the abilities check the CASL docs {@link https://casl.js.org/v5/en/guide/intro}
 */
@Injectable()
export class PermissionService {
  constructor(private rulesService: RulesService) {}

  /**
   * Creates an ability object containing all rules that are defined for the roles of the given user.
   * This ability object can be used to check the permissions of the user on various documents.
   *
   * @param user for which the ability object should be created
   * @returns DocumentAbility that allows to check the users permissions on a given document and action
   */
  getAbilityFor(user: UserInfo): DocumentAbility {
    const rules = this.rulesService.getRulesForUser(user);
    return new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });
  }
}
