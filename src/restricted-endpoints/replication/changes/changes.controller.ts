import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ChangesParams,
  ChangesResponse,
} from '../bulk-document/couchdb-dtos/changes.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { firstValueFrom, map } from 'rxjs';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import { UserInfo } from '../../session/user-auth.dto';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { omit } from 'lodash';

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
    const change = { results: [] } as ChangesResponse;
    let since = params?.since;
    while (true) {
      const res = await this.getPermittedChanges(
        db,
        { ...params, since },
        ability,
      );
      // missing changes till limit
      const missing = (params?.limit ?? Infinity) - change.results.length;
      // overflow changes of this request
      const discarded = Math.max(res.results.length - missing, 0);
      change.results.push(...res.results.slice(0, missing));
      if (discarded > 0) {
        // not all requested changes are used
        change.last_seq = change.results[change.results.length - 1].seq;
      } else {
        // all changes were used
        change.last_seq = res.last_seq;
      }
      change.pending = res.pending + discarded;
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
  ): Promise<ChangesResponse> {
    return firstValueFrom(
      this.couchdbService
        .get<ChangesResponse>(db, '_changes', {
          ...params,
          include_docs: true,
        })
        .pipe(map((res) => this.filterChanges(res, ability))),
    );
  }

  private filterChanges(
    changes: ChangesResponse,
    ability: DocumentAbility,
  ): ChangesResponse {
    return {
      ...changes,
      results: changes.results.filter(
        ({ doc }) =>
          // deleted doc without properties besides _id, _rev and _deleted
          (doc._deleted && Object.keys(doc).length === 3) ||
          ability.can('read', doc),
      ),
    };
  }
}
