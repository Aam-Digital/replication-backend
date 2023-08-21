import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ChangesResponse } from '../bulk-document/couchdb-dtos/changes.dto';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { map, Observable } from 'rxjs';
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
  changes(
    @Param('db') db: string,
    @Query() params,
    @User() user: UserInfo,
  ): Observable<ChangesResponse> {
    return this.couchdbService
      .get<ChangesResponse>(db, '_changes', {
        ...params,
        include_docs: true,
      })
      .pipe(map((res) => this.filterChanges(res, user)));
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
    return doc._deleted || ability.can('read', doc);
  }
}
