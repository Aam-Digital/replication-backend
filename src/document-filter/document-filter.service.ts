import { Injectable } from '@nestjs/common';
import { BulkGetResponse } from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import { AccessControlEntry } from './access-control-entry';
import { AllDocsResponse } from '../couch-proxy/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { SessionService } from '../session/session/session.service';

@Injectable()
export class DocumentFilterService {
  public accessControlList: AccessControlEntry[] = [
    { entity: 'Aser', roles: ['admin'] },
  ];

  constructor(private sessionService: SessionService) {}

  transformBulkGetResponse(response: BulkGetResponse): BulkGetResponse {
    response.results.forEach((result) =>
      result.docs
        .filter((doc) => (doc as { ok: DatabaseDocument }).ok)
        .forEach(
          (doc: { ok: DatabaseDocument }) =>
            (doc.ok = this.applyPermissionsToDoc(doc.ok)),
        ),
    );
    return response;
  }

  transformAllDocsResponse(response: AllDocsResponse): AllDocsResponse {
    response.rows.forEach(
      (row) => (row.doc = this.applyPermissionsToDoc(row.doc)),
    );
    return response;
  }

  filterBulkDocsRequest(request: BulkDocsRequest): BulkDocsRequest {
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter((doc) => this.hasPermissions(doc)),
    };
  }

  private applyPermissionsToDoc(doc: DatabaseDocument): DatabaseDocument {
    if (doc._deleted) {
      // Always pass deleted documents
      return doc;
    }
    if (this.hasPermissions(doc)) {
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

  private hasPermissions(doc: DatabaseDocument): boolean {
    const userRoles = this.sessionService.getRoles();
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
