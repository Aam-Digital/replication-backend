import { Injectable } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import { CouchdbService } from '../couchdb/couchdb.service';

/**
 * Service providing some general functionalities that are required in the context of administering the db and permissions.
 */
@Injectable()
export class AdminService {
  constructor(private couchdbService: CouchdbService) {}

  /**
   * Deletes all local documents of the remote database.
   * These document hold meta-information about the replication process.
   * Deleting them forces clients to re-run sync and check which documents are different.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#retrieve-replication-logs-from-source-and-target}
   *
   * @param db name of the database where the local documents should be deleted from
   *
   * This function should be called whenever the permissions change to re-trigger sync
   */
  async clearLocal(db: string) {
    const localDocsResponse = await firstValueFrom(
      this.couchdbService.get<AllDocsResponse>(db, '_local_docs'),
    );

    // Get IDs of the replication checkpoints
    const ids = localDocsResponse.rows
      .map((doc) => doc.id)
      .filter(
        (id) => !id.includes('purge-mrview') && !id.includes('shard-sync'),
      );
    const deletePromises = ids.map((id) =>
      firstValueFrom(this.couchdbService.delete(db, id)),
    );

    await Promise.all(deletePromises);
  }
}
