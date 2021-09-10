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

@Injectable()
export class DocumentFilterService {
  public accessControlList: AccessControlEntry[] = [
    { entity: 'Aser', roles: ['admin'] },
  ];

  transformBulkGetResponse(
    response: BulkGetResponse,
    userRoles: string[],
  ): BulkGetResponse {
    const withPermissions: BulkGetResult[] = response.results.map((result) => {
      return {
        id: result.id,
        docs: result.docs.filter((docResult) => {
          if (docResult.hasOwnProperty('ok')) {
            const document = (docResult as OkDoc).ok;
            return (
              document._deleted || this.hasPermissions(document, userRoles)
            );
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
    userRoles: string[],
  ): AllDocsResponse {
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter(
        (row) => row.doc._deleted || this.hasPermissions(row.doc, userRoles),
      ),
    };
  }

  filterBulkDocsRequest(
    request: BulkDocsRequest,
    userRoles: string[],
  ): BulkDocsRequest {
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter((doc) => this.hasPermissions(doc, userRoles)),
    };
  }

  private hasPermissions(doc: DatabaseDocument, userRoles: string[]): boolean {
    const matchingACLEntries = this.accessControlList.filter((entry) =>
      doc._id.toLowerCase().startsWith(entry.entity.toLowerCase() + ':'),
    );
    if (matchingACLEntries.length === 0) {
      // No permissions every user has permission
      return true;
    }
    return matchingACLEntries.some((entry) =>
      entry.roles.some((role) => userRoles.includes(role)),
    );
  }
}
