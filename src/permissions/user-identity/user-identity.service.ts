import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { DocumentChangesService } from '../../couchdb/document-changes.service';
import { UserInfo } from '../../restricted-endpoints/session/user-auth.dto';
import { UserAdminService } from './user-admin.service';

/**
 * Resolves and caches user identity data required for permission evaluation.
 * Cache is invalidated when user entity documents change in CouchDB.
 */
@Injectable()
export class UserIdentityService {
  private readonly logger = new Logger(UserIdentityService.name);
  private readonly cache = new Map<
    string,
    { value: UserInfo; expiresAtMs: number }
  >();
  /** Reverse index: entityName → userId, for O(1) change-feed filtering and invalidation. */
  private readonly entityNameIndex = new Map<string, string>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly userAdminService: UserAdminService,
    private readonly couchdbService: CouchdbService,
    private readonly documentChangesService: DocumentChangesService,
  ) {
    this.watchUserEntityChanges();
  }

  /**
   * Resolves full user info for a keycloak user id, including projects from CouchDB.
   */
  async resolveUser(userId: string): Promise<UserInfo> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.value;
    }

    const account = await this.userAdminService.getUserAccount(userId);

    const userEntity = await firstValueFrom(
      this.couchdbService.get('app', account.name),
    ).catch((error) => {
      this.logger.warn(
        `Failed to fetch projects for user entity ${account.name}`,
        error?.stack || error,
      );
      return undefined;
    });
    const projects = Array.isArray(userEntity?.projects)
      ? userEntity.projects.filter(
          (project): project is string => typeof project === 'string',
        )
      : [];

    const resolved = new UserInfo(
      account.id,
      account.name,
      account.roles,
      projects,
    );

    this.cache.set(userId, {
      value: resolved,
      expiresAtMs: Date.now() + this.cacheTtlMs,
    });
    this.entityNameIndex.set(account.name, userId);

    return resolved;
  }

  /**
   * Clears the entire identity cache, e.g. when permission rules change.
   */
  clearCache(): void {
    this.cache.clear();
    this.entityNameIndex.clear();
    this.logger.log('User identity cache cleared');
  }

  /**
   * Subscribes to the shared changes feed and invalidates
   * cache entries when their linked profile entity changes.
   * Uses the set of currently cached entity names for efficient O(1) filtering.
   */
  private watchUserEntityChanges(db = 'app'): void {
    this.documentChangesService.getChanges(db).subscribe({
      next: (change) => {
        if (this.entityNameIndex.has(change.id)) {
          this.invalidateByEntityName(change.id);
        }
      },
      error: (err) => {
        this.logger.error(
          `Entity changes feed terminated unexpectedly; cache invalidation disabled`,
          err?.stack || String(err),
        );
      },
    });
  }

  private invalidateByEntityName(entityName: string): void {
    const userId = this.entityNameIndex.get(entityName);
    this.entityNameIndex.delete(entityName);
    if (userId) {
      this.cache.delete(userId);
      this.logger.debug(`Invalidated cached identity for ${entityName}`);
    }
  }
}
