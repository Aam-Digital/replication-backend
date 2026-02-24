import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { omit } from 'lodash';
import { firstValueFrom, map } from 'rxjs';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { UserInfo } from '../../session/user-auth.dto';
import {
  ChangeResult,
  ChangesParams,
  ChangesResponse,
} from '../bulk-document/couchdb-dtos/changes.dto';

@UseGuards(CombinedAuthGuard)
@Controller()
export class ChangesController {
  constructor(
    private couchdbService: CouchdbService,
    private permissionService: PermissionService,
  ) {}

  /**
   * Get the changes stream.
   * The changes feed only returns the doc IDs to which the requesting user has access.
   * Even if `include_docs: true` is set, the stream will not return the document content.
   * @param db
   * @param params
   * @param user
   */
  @Get(':db/_changes')
  async changes(
    @Param('db') db: string,
    @User() user: UserInfo,
    @Query() params?: ChangesParams,
  ): Promise<ChangesResponse> {
    const ability = this.permissionService.getAbilityFor(user);
    const change = { results: [], lostPermissions: [] } as ChangesResponse;
    let since = params?.since;
    while (true) {
      const remainingChangesUntilLimit =
        (params?.limit ?? Infinity) - change.results.length;
      const res = await this.getPermittedChanges(
        db,
        { ...params, since },
        ability,
        remainingChangesUntilLimit,
      );
      change.results.push(...res.results);
      change.lostPermissions.push(...(res.lostPermissions ?? []));
      change.last_seq = res.last_seq;
      change.pending = res.pending;
      if (
        !params?.limit ||
        change.pending === 0 ||
        change.results.length >= params.limit
      ) {
        // enough changes found or none left
        break;
      }
      since = res.last_seq;
    }
    if (params?.include_docs !== 'true') {
      // remove doc content if not requested
      change.results = change.results.map((c) => omit(c, 'doc'));
    }
    return change;
  }

  getPermittedChanges(
    db: string,
    params: ChangesParams,
    ability: DocumentAbility,
    limit: number = Infinity,
  ): Promise<ChangesResponse> {
    return firstValueFrom(
      this.couchdbService
        .get<ChangesResponse>(db, '_changes', {
          ...params,
          include_docs: true,
        })
        .pipe(map((res) => this.filterChanges(res, ability, limit))),
    );
  }

  private filterChanges(
    changes: ChangesResponse,
    ability: DocumentAbility,
    limit: number = Infinity,
  ): ChangesResponse {
    const permitted: ChangeResult[] = [];
    const lostPermissions: string[] = [];
    let lastProcessedSeq = changes.last_seq;
    let unprocessedCount = 0;

    for (let i = 0; i < changes.results.length; i++) {
      const change = changes.results[i];
      const { doc } = change;

      const isPermitted = !doc
        ? change.deleted // tombstone with null doc
        : (doc._deleted && Object.keys(doc).length === 3) ||
          ability.can('read', doc);

      if (isPermitted) {
        if (permitted.length >= limit) {
          // This permitted result exceeds the limit - stop here
          unprocessedCount = changes.results.length - i;
          break;
        }
        permitted.push(change);
      } else if (doc) {
        // doc exists but user has no read permission - client should purge any local copy
        // TODO: could be limited to only include docs that may have been accessible before (e.g. only if entity type has a `conditions` rule in permissions)
        lostPermissions.push(doc._id);
      }

      lastProcessedSeq = change.seq;
    }

    return {
      ...changes,
      results: permitted,
      lostPermissions,
      last_seq: unprocessedCount > 0 ? lastProcessedSeq : changes.last_seq,
      pending: changes.pending + unprocessedCount,
    };
  }
}
