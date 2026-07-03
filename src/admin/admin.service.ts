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
    let failedCount = 0;
    // Page forward through _local_docs by id cursor. Advancing past the last
    // id seen each page (independent of whether its deletion succeeded) means
    // an undeletable doc cannot block progress to later pages, and we never
    // hold the full id set in memory. _local_docs paginates via
    // `startkey_docid` (see CouchDB /db/_local_docs docs), not `startkey`.
    let startkeyDocid: string | undefined;

    for (;;) {
      const params: Record<string, unknown> = {
        limit: AdminService.CLEAR_LOCAL_BATCH_SIZE,
      };
      if (startkeyDocid !== undefined) {
        params.startkey_docid = startkeyDocid;
        params.skip = 1; // exclude the boundary doc already processed
      }

      const localDocsResponse = await firstValueFrom(
        this.couchdbService.get<AllDocsResponse>(db, '_local_docs', params),
      );

      const rows = localDocsResponse.rows;
      if (rows.length === 0) {
        break;
      }
      startkeyDocid = rows[rows.length - 1].id;

      // Get IDs of the replication checkpoints, skipping couchdb-internal docs
      const ids = rows
        .map((doc) => doc.id)
        .filter(
          (id) => !id.includes('purge-mrview') && !id.includes('shard-sync'),
        );

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
          if (result.status === 'rejected') {
            failedCount++;
            this.logger.warn(
              `clearLocal(${db}): failed to delete ${chunk[index]}: ${result.reason}`,
            );
          }
        });
      }

      if (rows.length < AdminService.CLEAR_LOCAL_BATCH_SIZE) {
        break; // last page
      }
    }

    if (failedCount > 0) {
      throw new Error(
        `clearLocal(${db}): failed to delete ${failedCount} local document(s)`,
      );
    }
  }
}
