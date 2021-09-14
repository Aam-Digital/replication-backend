import { Injectable } from '@nestjs/common';
import {
  BulkGetResponse,
  BulkGetResult,
  OkDoc,
} from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AccessControlEntry } from './access-control-entry';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';

@Injectable()
export class DocumentFilterService {
  public accessControlList: AccessControlEntry[] = [
    { entity: 'Aser', roles: ['admin'] },
  ];

  transformBulkGetResponse(
    response: BulkGetResponse,
    user: User,
  ): BulkGetResponse {
    const withPermissions: BulkGetResult[] = response.results.map((result) => {
      return {
        id: result.id,
        docs: result.docs.filter((docResult) => {
          if (docResult.hasOwnProperty('ok')) {
            const document = (docResult as OkDoc).ok;
            return document._deleted || this.hasPermissions(document, user);
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

  transformAllDocsResponse(
    response: AllDocsResponse,
    user: User,
  ): AllDocsResponse {
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter(
        (row) => row.doc._deleted || this.hasPermissions(row.doc, user),
      ),
    };
  }

  filterBulkDocsRequest(request: BulkDocsRequest, user: User): BulkDocsRequest {
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter((doc) => this.hasPermissions(doc, user)),
    };
  }

  private hasPermissions(doc: DatabaseDocument, user: User): boolean {
    const matchingACLEntries = this.accessControlList.filter((entry) =>
      doc._id.toLowerCase().startsWith(entry.entity.toLowerCase() + ':'),
    );
    if (matchingACLEntries.length === 0) {
      // No permissions every user has permission
      return true;
    }
    return matchingACLEntries.some((entry) =>
      entry.roles.some((role) => user.roles.includes(role)),
    );
  }
}
