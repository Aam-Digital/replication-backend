import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import { CouchdbService } from '../couchdb/couchdb.service';

/**
 * Service providing some general functionalities that are required in the context of administering the db and permissions.
 */
@Injectable()
export class AdminService {
  /** page size when fetching _local docs */
  static readonly CLEAR_LOCAL_BATCH_SIZE = 500;
  /** maximum number of DELETE requests in flight at once */
  static readonly CLEAR_LOCAL_CONCURRENCY = 10;

  private readonly logger = new Logger(AdminService.name);

  constructor(private couchdbService: CouchdbService) {}

  /**
   * Deletes all local documents of the remote database.
   * These document hold meta-information about the replication process.
   * Deleting them forces clients to re-run sync and check which documents are different.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#retrieve-replication-logs-from-source-and-target}
   *
   * Documents are fetched in pages and deleted with bounded concurrency so
   * that large deployments (one checkpoint doc per client replication) do
   * not flood CouchDB with thousands of parallel DELETE requests.
   * All docs are attempted even if some deletions fail; an error summarizing
   * the failures is thrown at the end.
   *
   * @param db name of the database where the local documents should be deleted from
   *
   * This function should be called whenever the permissions change to re-trigger sync
   */
  async clearLocal(db: string): Promise<void> {
    // ids already attempted (successful or failed) — guards against endless
    // looping if a doc cannot be deleted and keeps pagination simple:
    // deleted docs disappear from _local_docs, so re-fetching the first page
    // naturally moves through the remainder.
    const attemptedIds = new Set<string>();
    let failedCount = 0;

    for (;;) {
      const localDocsResponse = await firstValueFrom(
        this.couchdbService.get<AllDocsResponse>(db, '_local_docs', {
          limit: AdminService.CLEAR_LOCAL_BATCH_SIZE,
        }),
      );

      // Get IDs of the replication checkpoints,
      // skipping couchdb-internal docs
      const ids = localDocsResponse.rows
        .map((doc) => doc.id)
        .filter(
          (id) =>
            !id.includes('purge-mrview') &&
            !id.includes('shard-sync') &&
            !attemptedIds.has(id),
        );

      if (ids.length === 0) {
        break;
      }

      for (
        let i = 0;
        i < ids.length;
        i += AdminService.CLEAR_LOCAL_CONCURRENCY
      ) {
        const chunk = ids.slice(i, i + AdminService.CLEAR_LOCAL_CONCURRENCY);
        const results = await Promise.allSettled(
          chunk.map((id) => firstValueFrom(this.couchdbService.delete(db, id))),
        );
        results.forEach((result, index) => {
          attemptedIds.add(chunk[index]);
          if (result.status === 'rejected') {
            failedCount++;
            this.logger.warn(
              `clearLocal(${db}): failed to delete ${chunk[index]}: ${result.reason}`,
            );
          }
        });
      }
    }

    if (failedCount > 0) {
      throw new Error(
        `clearLocal(${db}): failed to delete ${failedCount} local document(s)`,
      );
    }
  }
}
