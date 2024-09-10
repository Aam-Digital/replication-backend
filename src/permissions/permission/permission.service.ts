import { Injectable } from '@nestjs/common';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';
import { Ability, AbilityClass, InferSubjects } from '@casl/ability';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';

const actions = [
  'read',
  'create',
  'update',
  'delete',
  'manage', // Matches any actions
] as const;

export type Action = (typeof actions)[number];
type Subject = InferSubjects<typeof DatabaseDocument> | string;
export type DocumentAbility = Ability<[Action, Subject]>;
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
  constructor(
    private rulesService: RulesService,
    private couchdbService: CouchdbService,
  ) {}

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

  async isAllowedTo(
    action: Action,
    documentToAccess: DatabaseDocument,
    user: UserInfo,
    db: string,
  ): Promise<boolean> {
    const userAbility = this.getAbilityFor(user);

    let documentForPermissionCheck: DatabaseDocument = documentToAccess;
    let actionForPermissionCheck: Action = action;

    if (db === 'app-attachments') {
      // check permissions on the actual, full entity so that special condition rules can be applied
      documentForPermissionCheck = await firstValueFrom(
        this.couchdbService.get('app', documentToAccess._id),
      ).catch(() => undefined);

      // on app-attachments we are logically only editing a field of the entity, so update permission should be enough
      if (action !== 'read') {
        actionForPermissionCheck = 'update';
      }
    }

    return userAbility.can(
      actionForPermissionCheck,
      documentForPermissionCheck,
    );
  }
}
