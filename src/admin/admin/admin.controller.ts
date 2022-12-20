import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { RulesConfig } from '../../permissions/rules/permission';
import { RulesService } from '../../permissions/rules/rules.service';
import { firstValueFrom } from 'rxjs';
import { AllDocsResponse } from '../../restricted-endpoints/replication/replication-endpoints/couchdb-dtos/all-docs.dto';
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
  constructor(
    private rulesService: RulesService,
    private couchdbService: CouchdbService,
  ) {}

  /**
   * Reload the rules object from the database to apply changed permissions.
   *
   * @param db name of database from which the rules should be fetched
   */
  @Post('/reload/:db')
  reloadRules(@Param('db') db: string): Promise<RulesConfig> {
    return this.rulesService.loadRules(db);
  }

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
