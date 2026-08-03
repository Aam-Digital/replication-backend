import {
  CreateAbility,
  InferSubjects,
  MongoAbility,
  createMongoAbility,
} from '@casl/ability';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';

const actions = [
  'read',
  'create',
  'update',
  'delete',
  'manage', // Matches any actions
] as const;

export type Action = (typeof actions)[number];
type Subject = InferSubjects<typeof DatabaseDocument> | string;
export type DocumentAbility = MongoAbility<[Action, Subject]>;
export const createDocumentAbility =
  createMongoAbility as CreateAbility<DocumentAbility>;

export function detectDocumentType(subject: DatabaseDocument): string {
  if (!subject._id) {
    throw new Error('Cannot detect document type: missing _id');
  }
  return subject._id.split(':')[0];
}

/**
 * Service that creates ability objects which can be used to check permissions.
 *
 * For more information about the abilities check the CASL docs {@link https://casl.js.org/v5/en/guide/intro}
 */
@Injectable()
export class PermissionService {
  /** safety cap to bound memory for systems with very many distinct users */
  static readonly ABILITY_CACHE_MAX_ENTRIES = 1000;

  private readonly abilityCache = new Map<string, DocumentAbility>();

  constructor(
    private rulesService: RulesService,
    private couchdbService: CouchdbService,
  ) {
    this.rulesService.permissionsChanged$.subscribe(() =>
      this.abilityCache.clear(),
    );
  }

  /**
   * Creates an ability object containing all rules that are defined for the roles of the given user.
   * This ability object can be used to check the permissions of the user on various documents.
   *
   * Abilities are cached per user identity: building one deep-clones all
   * rules (user variable injection) and compiles them with CASL, which is
   * wasteful to repeat on every request.
   *
   * An ability is a pure function of the permission config and the user — so
   * no time-based expiry is needed: nothing can go stale without one of the
   * two changing. A config change clears the whole cache (via
   * RulesService.permissionsChanged$); a changed user maps to a different key.
   *
   * @param user for which the ability object should be created
   * @returns DocumentAbility that allows to check the users permissions on a given document and action
   */
  getAbilityFor(user: UserInfo): DocumentAbility {
    const key = this.abilityCacheKey(user);
    const cached = this.abilityCache.get(key);
    if (cached) {
      return cached;
    }

    const rules = this.rulesService.getRulesForUser(user);
    const ability = createDocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    if (this.abilityCache.size >= PermissionService.ABILITY_CACHE_MAX_ENTRIES) {
      // simple wholesale eviction; entries are cheap to rebuild
      this.abilityCache.clear();
    }
    this.abilityCache.set(key, ability);
    return ability;
  }

  /**
   * Cache key covering everything that influences the computed rules.
   * RulesService can inject *any* `${user.*}` field into rule conditions, so
   * the key reflects the whole user object — keying on a fixed subset would
   * let two users that differ only in some other referenced field share a
   * cached ability.
   */
  private abilityCacheKey(user: UserInfo): string {
    if (!user) {
      return 'anonymous';
    }
    return JSON.stringify(user);
  }

  async isAllowedTo(
    action: Action,
    documentToAccess: DatabaseDocument,
    user: UserInfo,
    db: string,
  ): Promise<boolean> {
    const userAbility = this.getAbilityFor(user);

    let documentForPermissionCheck: DatabaseDocument | undefined =
      documentToAccess;

    if (db === 'app-attachments') {
      // check permissions on the actual, full entity so that special condition rules can be applied
      documentForPermissionCheck = await firstValueFrom(
        this.couchdbService.get('app', documentToAccess._id!),
      ).catch(() => undefined);

      // For attachment operations, allow if user has either create OR update permission
      // since attachments logically modify a field of the entity
      // create/update/delete the attachment doc can happen during create/update/delete of the entity - and therefore we do have to allow any of these edit actions if the user has any one of those permissions. `read` is more sensitive than these and needs to be handled strictly
      if (action !== 'read') {
        return (
          !!documentForPermissionCheck &&
          (userAbility.can('create', documentForPermissionCheck) ||
            userAbility.can('update', documentForPermissionCheck))
        );
      }
    }

    return (
      !!documentForPermissionCheck &&
      userAbility.can(action, documentForPermissionCheck)
    );
  }
}
