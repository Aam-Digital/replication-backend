import { Injectable, Logger } from '@nestjs/common';
import { BulkGetResult, ErrorDoc, OkDoc } from './couchdb-dtos/bulk-get.dto';
import {
  AllDocsRequest,
  AllDocsResponse,
  DocMetaInf,
} from './couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
  DatabaseDocument,
  DocError,
} from './couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../../session/user-auth.dto';
import { PermissionService } from '../../../permissions/permission/permission.service';
import { firstValueFrom } from 'rxjs';
import { Ability } from '@casl/ability';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { AuditService } from '../../../audit/audit.service';
import { AttachmentCleanupService } from '../../../couchdb/attachment-cleanup.service';

/**
 * Handle bulk document requests with the remote CouchDB server
 * enforcing the permissions of the given user.
 */
@Injectable()
export class BulkDocumentService {
  private readonly logger = new Logger(BulkDocumentService.name);

  constructor(
    private readonly permissionService: PermissionService,
    private readonly couchdbService: CouchdbService,
    private readonly documentFilter: DocumentFilterService,
    private readonly auditService: AuditService,
    private readonly attachmentCleanupService: AttachmentCleanupService,
  ) {}

  /**
   * Per-item filter for single results of a `_bulk_get` response.
   * Returns the result with non-permitted docs removed,
   * or `undefined` if the whole result should be dropped.
   *
   * Used by the streaming `_bulk_get` endpoint.
   */
  bulkGetResultMapper(
    user: UserInfo,
  ): (result: BulkGetResult) => BulkGetResult | undefined {
    const ability = this.permissionService.getAbilityFor(user);
    return (result) => {
      if (!this.documentFilter.isReplicable(result.id)) {
        return undefined;
      }
      const docs = result.docs.filter((doc) =>
        this.isPermittedBulkGetDoc(doc, ability),
      );
      // Only return results where at least one document is left
      if (docs.length === 0) {
        return undefined;
      }
      return { id: result.id, docs };
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

  /**
   * Per-row permission filter for `_all_docs` responses.
   *
   * Used by the streaming `_all_docs` endpoint.
   */
  allDocsRowFilter(user: UserInfo): (row: DocMetaInf) => boolean {
    const ability = this.permissionService.getAbilityFor(user);
    return (row) =>
      // rows without id are error entries for missing keys
      // (e.g. {key, error: "not_found"}) and are passed through
      !row.id ||
      (this.documentFilter.isReplicable(row.id) &&
        (row.doc ? row.doc._deleted || ability.can('read', row.doc) : true));
  }

  /**
   * Filter, write and audit a bulk-docs request as one cohesive unit.
   *
   * The previously-fetched `existingDocs` (needed for permission checks) is
   * reused as the "before" state for the audit diff, so it never leaves the
   * service and the hot path fetches each existing doc only once.
   *
   * Docs the user may not write are not forwarded and get a `forbidden`
   * result instead, as CouchDB reports a doc rejected by validation.
   */
  async handleBulkDocs(
    request: BulkDocsRequest,
    user: UserInfo,
    db: string,
  ): Promise<BulkDocsResponse> {
    const existingDocs = await this.fetchExistingDocs(request.docs, db);
    const decisions = this.decideWrites(request, user, existingDocs);
    const forwarded: BulkDocsRequest = {
      new_edits: request.new_edits,
      docs: request.docs.filter((_, i) => decisions[i] === 'forward'),
    };
    if (forwarded.docs.length === 0) {
      return this.toClientResponse(request, decisions, []);
    }

    const response = await firstValueFrom(
      this.couchdbService.post<BulkDocsResponse>(db, '_bulk_docs', forwarded),
    );
    await this.auditService.recordBulkWrite(
      db,
      forwarded,
      existingDocs,
      response,
      user,
    );
    await this.attachmentCleanupService.cleanupForBulkWrite(
      db,
      forwarded,
      response,
    );
    return this.toClientResponse(request, decisions, response);
  }

  /**
   * Add a `forbidden` result for each denied doc to CouchDB's response.
   *
   * With `new_edits: false` (replication) CouchDB lists only failed docs, and
   * an omitted doc counts as written - which is how non-replicable docs (e.g.
   * a client's local index definitions) are ignored without a failure.
   * Otherwise every submitted doc gets a result in its original position.
   */
  private toClientResponse(
    request: BulkDocsRequest,
    decisions: WriteDecision[],
    couchdbResponse: BulkDocsResponse,
  ): BulkDocsResponse {
    if (request.new_edits === false) {
      const denied = request.docs
        .filter((_, i) => decisions[i] === 'deny')
        .map((doc) => forbiddenResult(doc));
      return [...couchdbResponse, ...denied];
    }

    let next = 0;
    return request.docs.map((doc, i) =>
      decisions[i] === 'forward'
        ? couchdbResponse[next++]
        : forbiddenResult(doc),
    );
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

  /** Decide for each submitted doc (by position) whether it is forwarded to CouchDB. */
  private decideWrites(
    request: BulkDocsRequest,
    user: UserInfo,
    existingDocs: Map<string, DatabaseDocument>,
  ): WriteDecision[] {
    const ability = this.permissionService.getAbilityFor(user);
    const deniedIds: string[] = [];
    const deniedActions: Partial<Record<WriteAction, number>> = {};

    const decisions = request.docs.map((doc): WriteDecision => {
      if (!doc._id || !this.documentFilter.isReplicable(doc._id)) {
        return 'ignore';
      }
      const existingDoc = existingDocs.get(doc._id);
      const action = requiredAction(doc, existingDoc);
      if (ability.can(action, existingDoc ?? doc)) {
        return 'forward';
      }
      deniedIds.push(doc._id);
      deniedActions[action] = (deniedActions[action] ?? 0) + 1;
      return 'deny';
    });

    if (deniedIds.length > 0) {
      // The client gets a `forbidden` result for these, but its local copy
      // keeps the rejected change. Log to make this traceable.
      this.logger.warn(`_bulk_docs: dropped doc(s) without write permission`, {
        user: user?.name,
        ids: deniedIds,
        actions: deniedActions,
      });
    }

    return decisions;
  }

  /**
   * Per-doc permission filter for `_find` responses.
   *
   * Used by the streaming `_find` endpoint.
   */
  findDocFilter(user: UserInfo): (doc: DatabaseDocument) => boolean {
    const ability = this.permissionService.getAbilityFor(user);
    return (doc) =>
      !!doc._id &&
      this.documentFilter.isReplicable(doc._id) &&
      ability.can('read', doc);
  }
}

/**
 * What happens to a submitted doc: written to CouchDB, refused for missing
 * permissions, or not writable through this proxy at all (no `_id` or a
 * non-replicable prefix such as `_design/`).
 */
type WriteDecision = 'forward' | 'deny' | 'ignore';

type WriteAction = 'create' | 'update' | 'delete';

/** The permission needed to write `updatedDoc`, checked against `existingDoc` if there is one. */
function requiredAction(
  updatedDoc: DatabaseDocument,
  existingDoc: DatabaseDocument | undefined,
): WriteAction {
  if (!existingDoc) {
    return 'create';
  }
  return updatedDoc._deleted ? 'delete' : 'update';
}

/**
 * A `_bulk_docs` result for a doc this proxy refuses to write.
 *
 * The reason is the same for every action, so it does not reveal whether
 * the doc already exists on the server.
 */
function forbiddenResult(doc: DatabaseDocument): DocError {
  return {
    id: doc._id,
    rev: doc._rev,
    error: 'forbidden',
    reason: 'missing permission to write this document',
  } as DocError;
}
