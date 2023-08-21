import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ChangesParams,
  ChangesResponse,
} from '../bulk-document/couchdb-dtos/changes.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { firstValueFrom, map } from 'rxjs';
import { OnlyAuthenticated } from '../../../auth/only-authenticated.decorator';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import { UserInfo } from '../../session/user-auth.dto';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { DatabaseDocument } from '../bulk-document/couchdb-dtos/bulk-docs.dto';
import { omit } from 'lodash';

@OnlyAuthenticated()
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
    @Query() params: ChangesParams,
    @User() user: UserInfo,
  ): Promise<ChangesResponse> {
    const changes: ChangesResponse[] = [];
    let permittedChanges = 0;
    let since = params.since;
    if (params.limit) {
      while (permittedChanges < params.limit) {
        const res = await firstValueFrom(
          this.couchdbService
            .get<ChangesResponse>(db, '_changes', {
              ...params,
              since,
              include_docs: true,
            })
            .pipe(map((res) => this.filterChanges(res, user))),
        );
        changes.push(res);
        if (res.pending === 0) {
          break;
        }
        since = res.last_seq;
        permittedChanges += res.results.length;
      }
      const combinedChanges = { results: [] } as ChangesResponse;
      for (const change of changes) {
        if (
          combinedChanges.results.length + change.results.length <
          params.limit
        ) {
          combinedChanges.results.push(...change.results);
          combinedChanges.pending = change.pending;
          combinedChanges.last_seq = change.last_seq;
        } else if (
          combinedChanges.results.length + change.results.length >=
          params.limit
        ) {
          const missing = params.limit - combinedChanges.results.length;
          const discarded = change.results.length - missing;
          combinedChanges.results.push(...change.results);
          combinedChanges.last_seq =
            combinedChanges.results[combinedChanges.results.length - 1].seq;
          combinedChanges.pending = change.pending + discarded;
          break;
        }
      }
      return combinedChanges;
    }
  }

  private filterChanges(
    changes: ChangesResponse,
    user: UserInfo,
  ): ChangesResponse {
    const ability = this.permissionService.getAbilityFor(user);
    changes.results = changes.results
      .filter((change) => this.canReadDoc(change.doc, ability))
      .map((change) => omit(change, 'doc'));
    return changes;
  }

  private canReadDoc(doc: DatabaseDocument, ability: DocumentAbility) {
    // TODO test if deleted doc content can be retrieved
    return doc._deleted || ability.can('read', doc);
  }
}
