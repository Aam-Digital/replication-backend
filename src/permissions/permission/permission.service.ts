import { Ability, AbilityClass, InferSubjects } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { RulesService } from '../rules/rules.service';
import { TtlCache } from '../../common/ttl-cache';

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
  /** TTL aligned with the user identity cache in UserIdentityService */
  static readonly ABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
  /** safety cap to bound memory for systems with very many distinct users */
  static readonly ABILITY_CACHE_MAX_ENTRIES = 1000;

  private readonly abilityCache = new TtlCache<{
    ability: DocumentAbility;
    configVersion: number;
  }>(
    PermissionService.ABILITY_CACHE_TTL_MS,
    PermissionService.ABILITY_CACHE_MAX_ENTRIES,
  );

  constructor(
    private rulesService: RulesService,
    private couchdbService: CouchdbService,
  ) {}

  /**
   * Creates an ability object containing all rules that are defined for the roles of the given user.
   * This ability object can be used to check the permissions of the user on various documents.
   *
   * Abilities are cached per user identity: building one deep-clones all
   * rules (user variable injection) and compiles them with CASL, which is
   * wasteful to repeat on every request. Entries are invalidated when the
   * permission config changes (via RulesService.configVersion) or after a
   * TTL, mirroring the user identity cache.
   *
   * @param user for which the ability object should be created
   * @returns DocumentAbility that allows to check the users permissions on a given document and action
   */
  getAbilityFor(user: UserInfo): DocumentAbility {
    const key = this.abilityCacheKey(user);
    const configVersion = this.rulesService.configVersion;
    const cached = this.abilityCache.get(key);
    if (cached && cached.configVersion === configVersion) {
      return cached.ability;
    }

    const rules = this.rulesService.getRulesForUser(user);
    const ability = new DocumentAbility(rules, {
      detectSubjectType: detectDocumentType,
    });

    this.abilityCache.set(key, { ability, configVersion });
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
