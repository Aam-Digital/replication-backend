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
      const revs = await firstValueFrom(
        this.couchdbService.post<AllDocsResponse>(attachmentsDb, '_all_docs', {
          keys: docIds,
        }),
      );
      const docs = (revs.rows ?? [])
        // unknown keys come back as {key, error: "not_found"} rows without a value
        .filter((row) => row.value?.rev)
        .map((row) => ({ _id: row.id, _rev: row.value.rev, _deleted: true }));
      if (docs.length === 0) {
        return;
      }
      await firstValueFrom(
        this.couchdbService.post(attachmentsDb, '_bulk_docs', { docs }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to clean up ${attachmentsDb} for ${docIds.length} deleted doc(s)`,
        { docIds, error: err instanceof Error ? err.message : err },
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
   * `_bulk_docs` response lists only the docs that FAILED; everything absent
   * from it succeeded. With `new_edits: true` it is the reverse: only
   * successes are listed (with `ok`/`rev`).
   */
  private successfullyDeletedIds(
    written: BulkDocsRequest,
    response: BulkDocsResponse,
  ): string[] {
    const newEditsFalse = written.new_edits === false;
    const errorIds = new Set<string>();
    const okIds = new Set<string>();
    for (const result of response ?? []) {
      if ((result as DocError).error) {
        errorIds.add(result.id);
      } else {
        okIds.add(result.id);
      }
    }
    return written.docs
      .filter((doc) => doc._deleted && doc._id)
      .filter((doc) =>
        newEditsFalse ? !errorIds.has(doc._id!) : okIds.has(doc._id!),
      )
      .map((doc) => doc._id!);
  }
}
