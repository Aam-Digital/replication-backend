import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { AllDocsResponse } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../../auth/only-authenticated.decorator';

/**
 * This service provides some general administrativ endpoints.
 */
@OnlyAuthenticated()
@UseGuards(CombinedAuthGuard)
@Controller('admin')
export class AdminController {
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
  @Post('/clear_local/:db')
  async clearLocal(@Param('db') db: string): Promise<any> {
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
    return true;
  }
}
