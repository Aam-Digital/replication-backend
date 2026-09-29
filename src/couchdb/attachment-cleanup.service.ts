import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CouchdbService } from './couchdb.service';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
  DocError,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';

/**
 * Deletes the `<db>-attachments` document that belongs to an entity once the
 * entity itself has been deleted from `<db>`, so files don't outlive their
 * entity (see the permission-race described in
 * https://github.com/Aam-Digital/replication-backend/issues/317: deleting
 * client-side races replication and can leave attachments permanently
 * undeletable through the normal API).
 *
 * Best-effort: a failure here must never fail the entity delete that
 * triggered it. Existing orphans left by earlier deletes (or by a cleanup
 * that failed) are handled separately by a manual sweep, not retried here.
 */
@Injectable()
export class AttachmentCleanupService {
  private readonly logger = new Logger(AttachmentCleanupService.name);

  constructor(private readonly couchdbService: CouchdbService) {}

  /**
   * Delete the `<db>-attachments` documents for the given (already deleted)
   * entity ids, if they exist.
   */
  async cleanupForDeletedDocs(db: string, docIds: string[]): Promise<void> {
    if (docIds.length === 0) {
      return;
    }

    const attachmentsDb = `${db}-attachments`;
    try {
      const confirmedIds = await this.filterStillDeleted(db, docIds);
      if (confirmedIds.length === 0) {
        return;
      }

      const revs = await firstValueFrom(
        this.couchdbService.post<AllDocsResponse>(attachmentsDb, '_all_docs', {
          keys: confirmedIds,
        }),
      );
      const docs = (revs.rows ?? [])
        // unknown keys come back as {key, error: "not_found"} rows without a value
        .filter((row) => row.value?.rev)
        .map((row) => ({ _id: row.id, _rev: row.value.rev, _deleted: true }));
      if (docs.length === 0) {
        return;
      }
      const result = await firstValueFrom(
        this.couchdbService.post<BulkDocsResponse>(
          attachmentsDb,
          '_bulk_docs',
          {
            docs,
          },
        ),
      );
      this.logFailedDeletes(attachmentsDb, result);
    } catch (err) {
      this.logger.warn(
        `Failed to clean up ${attachmentsDb} for ${docIds.length} deleted doc(s)`,
        { docIds, error: err instanceof Error ? err.message : err },
      );
    }
  }

  /**
   * A delete tombstone can be accepted as a non-winning revision when the
   * same document has a conflicting, still-live edit - offline conflicts are
   * a normal occurrence for a syncing app, and CouchDB reports that as a
   * plain success, not an error. Re-checking `db` right before deleting
   * confirms the entity isn't actually still alive under a different
   * revision.
   */
  private async filterStillDeleted(
    db: string,
    docIds: string[],
  ): Promise<string[]> {
    const response = await firstValueFrom(
      this.couchdbService.post<AllDocsResponse>(db, '_all_docs', {
        keys: docIds,
      }),
    );
    const liveIds = new Set(
      (response.rows ?? [])
        .filter((row) => row.value?.rev)
        .map((row) => row.id),
    );
    return docIds.filter((id) => !liveIds.has(id));
  }

  private logFailedDeletes(
    attachmentsDb: string,
    result: BulkDocsResponse,
  ): void {
    const failures = (result ?? []).filter(
      (entry): entry is DocError => !!(entry as DocError).error,
    );
    if (failures.length > 0) {
      this.logger.warn(
        `Failed to delete ${failures.length} attachment doc(s) in ${attachmentsDb}`,
        { failures },
      );
    }
  }

  /**
   * Same as {@link cleanupForDeletedDocs}, but derived from a `_bulk_docs`
   * write: only the docs that were both marked `_deleted` and actually
   * succeeded are cleaned up.
   */
  async cleanupForBulkWrite(
    db: string,
    written: BulkDocsRequest,
    response: BulkDocsResponse,
  ): Promise<void> {
    const deletedIds = this.successfullyDeletedIds(written, response);
    await this.cleanupForDeletedDocs(db, deletedIds);
  }

  /**
   * With `new_edits: false` (replicated/PouchDB-pushed writes) CouchDB's
   * `_bulk_docs` response lists only the docs that FAILED, keyed by the
   * caller-assigned (id, rev) of the exact revision that failed - matched
   * here by (id, rev) rather than id alone, since the same id can appear
   * more than once in one batch (e.g. two conflicting leaf revisions of the
   * same entity pushed together) and an id-only match would misattribute
   * one doc's error to the other.
   *
   * With `new_edits: true`, CouchDB instead returns exactly one result per
   * submitted doc, in the same order, with a server-assigned rev that never
   * equals the submitted one - paired here by position instead.
   */
  private successfullyDeletedIds(
    written: BulkDocsRequest,
    response: BulkDocsResponse,
  ): string[] {
    if (written.new_edits === false) {
      const erroredRevs = new Set(
        (response ?? [])
          .filter((entry): entry is DocError => !!(entry as DocError).error)
          .map((entry) => this.revKey(entry.id, entry.rev)),
      );
      return written.docs
        .filter((doc) => doc._deleted && doc._id && doc._rev)
        .filter((doc) => !erroredRevs.has(this.revKey(doc._id!, doc._rev!)))
        .map((doc) => doc._id!);
    }

    return written.docs
      .map((doc, i) => ({ doc, result: response?.[i] }))
      .filter(({ doc }) => doc._deleted && doc._id)
      .filter(({ result }) => !!result && !(result as DocError).error)
      .map(({ doc }) => doc._id!);
  }

  private revKey(id: string, rev: string): string {
    return `${id}\u0000${rev}`;
  }
}
