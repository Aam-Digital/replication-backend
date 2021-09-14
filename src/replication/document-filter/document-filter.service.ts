import { Injectable } from '@nestjs/common';
import {
  BulkGetResponse,
  BulkGetResult,
  OkDoc,
} from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import { BulkDocsRequest } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';
import { PermissionService } from '../permission/permission.service';
import { Action } from '../rules/action';

@Injectable()
export class DocumentFilterService {
  constructor(private permissionService: PermissionService) {}

  filterBulkGetResponse(
    response: BulkGetResponse,
    user: User,
  ): BulkGetResponse {
    const ability = this.permissionService.getAbilityFor(user);
    const withPermissions: BulkGetResult[] = response.results.map((result) => {
      return {
        id: result.id,
        docs: result.docs.filter((docResult) => {
          if (docResult.hasOwnProperty('ok')) {
            const document = (docResult as OkDoc).ok;
            return document._deleted || ability.can(Action.READ, document);
          } else {
            // error
            return true;
          }
        }),
      };
    });
    // Only return results where at least one document is left
    return {
      results: withPermissions.filter((result) => result.docs.length > 0),
    };
  }

  filterAllDocsResponse(
    response: AllDocsResponse,
    user: User,
  ): AllDocsResponse {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter(
        (row) => row.doc._deleted || ability.can(Action.READ, row.doc),
      ),
    };
  }

  filterBulkDocsRequest(request: BulkDocsRequest, user: User): BulkDocsRequest {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter((doc) => ability.can(Action.WRITE, doc)),
    };
  }
}
