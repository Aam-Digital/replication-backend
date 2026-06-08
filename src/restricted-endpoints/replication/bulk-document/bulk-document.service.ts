import { Injectable } from '@nestjs/common';
import {
  BulkGetResponse,
  BulkGetResult,
  ErrorDoc,
  OkDoc,
} from './couchdb-dtos/bulk-get.dto';
import { AllDocsRequest, AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
  DatabaseDocument,
  FindResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { firstValueFrom } from 'rxjs';
import { Ability } from '@casl/ability';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { AuditService } from '../../../audit/audit.service';

/**
 * Handle bulk document requests with the remote CouchDB server
 * enforcing the permissions of the given user.
 */
@Injectable()
export class BulkDocumentService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly couchdbService: CouchdbService,
    private readonly documentFilter: DocumentFilterService,
    private readonly auditService: AuditService,
  ) {}

  filterBulkGetResponse(
    response: BulkGetResponse,
    user: UserInfo,
  ): BulkGetResponse {
    const ability = this.permissionService.getAbilityFor(user);
    const withPermissions: BulkGetResult[] = response.results
      .filter((result) => this.documentFilter.isReplicable(result.id))
      .map((result) => ({
        id: result.id,
        docs: result.docs.filter((doc) =>
          this.isPermittedBulkGetDoc(doc, ability),
        ),
      }));
    // Only return results where at least one document is left
    return {
      results: withPermissions.filter((result) => result.docs.length > 0),
    };
  }

  private isPermittedBulkGetDoc(docResult: OkDoc | ErrorDoc, ability: Ability) {
    if (docResult.hasOwnProperty('ok')) {
      const document = (docResult as OkDoc).ok;
      return document._deleted || ability.can('read', document);
    } else {
      // error - always return these
      return true;
    }
  }

  filterAllDocsResponse(
    response: AllDocsResponse,
    user: UserInfo,
  ): AllDocsResponse {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter(
        (row) =>
          this.documentFilter.isReplicable(row.id) &&
          (row.doc ? row.doc._deleted || ability.can('read', row.doc) : true),
      ),
    };
  }

  /**
   * Filter, write and audit a bulk-docs request as one cohesive unit.
   *
   * The previously-fetched `existingDocs` (needed for permission checks) is
   * reused as the "before" state for the audit diff, so it never leaves the
   * service and the hot path fetches each existing doc only once.
   */
  async handleBulkDocs(
    request: BulkDocsRequest,
    user: UserInfo,
    db: string,
  ): Promise<BulkDocsResponse> {
    const existingDocs = await this.fetchExistingDocs(request.docs, db);
    const filtered = this.filterDocs(request, user, existingDocs);
    const response = await firstValueFrom(
      this.couchdbService.post<BulkDocsResponse>(db, '_bulk_docs', filtered),
    );
    await this.auditService.recordBulkWrite(
      db,
      filtered,
      existingDocs,
      response,
      user,
    );
    return response;
  }

  async filterBulkDocsRequest(
    request: BulkDocsRequest,
    user: UserInfo,
    db: string,
  ): Promise<BulkDocsRequest> {
    const existingDocs = await this.fetchExistingDocs(request.docs, db);
    return this.filterDocs(request, user, existingDocs);
  }

  /**
   * Fetch the current revision of every doc in the request (for permission
   * checks and as the audit "before" state), keyed by `_id`.
   */
  private async fetchExistingDocs(
    docs: DatabaseDocument[],
    db: string,
  ): Promise<Map<string, DatabaseDocument>> {
    const allDocsRequest: AllDocsRequest = {
      keys: docs.map((doc) => doc._id).filter((id): id is string => !!id),
    };
    const response = await firstValueFrom(
      this.couchdbService.post<AllDocsResponse>(
        db,
        '_all_docs',
        allDocsRequest,
        {
          include_docs: true,
        },
      ),
    );
    const existingDocs = new Map<string, DatabaseDocument>();
    for (const row of response.rows ?? []) {
      if (row.doc) {
        existingDocs.set(row.id, row.doc);
      }
    }
    return existingDocs;
  }

  private filterDocs(
    request: BulkDocsRequest,
    user: UserInfo,
    existingDocs: Map<string, DatabaseDocument>,
  ): BulkDocsRequest {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter(
        (doc) =>
          !!doc._id &&
          this.documentFilter.isReplicable(doc._id) &&
          this.hasPermissionsForDoc(doc, existingDocs.get(doc._id), ability),
      ),
    };
  }

  filterFindResponse(request: FindResponse, user: UserInfo): FindResponse {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      bookmark: request.bookmark,
      warning: request.warning,
      docs: request.docs.filter(
        (doc) =>
          !!doc._id &&
          this.documentFilter.isReplicable(doc._id) &&
          ability.can('read', doc),
      ),
    };
  }

  private hasPermissionsForDoc(
    updatedDoc: DatabaseDocument,
    existingDoc: DatabaseDocument | undefined,
    ability: DocumentAbility,
  ) {
    if (existingDoc) {
      if (updatedDoc._deleted) {
        return ability.can('delete', existingDoc);
      } else {
        return ability.can('update', existingDoc);
      }
    } else {
      return ability.can('create', updatedDoc);
    }
  }
}
