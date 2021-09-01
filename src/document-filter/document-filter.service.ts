import { Injectable } from '@nestjs/common';
import { BulkGetResponse } from '../couch-proxy/couch-interfaces/bulk-get';
import { AccessControlEntry } from './access-control-entry';
import { AllDocsResponse } from '../couch-proxy/couch-interfaces/all-docs';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couch-interfaces/bulk-docs';

@Injectable()
export class DocumentFilterService {
  public accessControlList: AccessControlEntry[] = [
    { entity: 'Aser', roles: ['admin'] },
  ];

  transformBulkGetResponse(
    response: BulkGetResponse,
    userRoles: string[],
  ): BulkGetResponse {
    response.results.forEach((result) =>
      result.docs
        .filter((doc) => (doc as { ok: DatabaseDocument }).ok)
        .forEach(
          (doc: { ok: DatabaseDocument }) =>
            (doc.ok = this.applyPermissionsToDoc(doc.ok, userRoles)),
        ),
    );
    return response;
  }

  transformAllDocsResponse(
    response: AllDocsResponse,
    userRoles: string[],
  ): AllDocsResponse {
    response.rows.forEach(
      (row) => (row.doc = this.applyPermissionsToDoc(row.doc, userRoles)),
    );
    return response;
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

  private applyPermissionsToDoc(
    doc: DatabaseDocument,
    userRoles: string[],
  ): DatabaseDocument {
    if (doc._deleted) {
      // Always pass deleted documents
      return doc;
    }
    if (this.hasPermissions(doc, userRoles)) {
      return doc;
    } else {
      // Send deleted response so local elements are deleted
      return {
        _id: doc._id,
        _rev: doc._rev,
        _revisions: doc._revisions,
        _deleted: true,
      };
    }
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
