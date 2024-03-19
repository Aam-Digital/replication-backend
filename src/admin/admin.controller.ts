import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { CombinedAuthGuard } from '../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../auth/only-authenticated.decorator';
import { AdminService } from './admin.service';

/**
 * This service provides some general administrativ endpoints.
 */
@OnlyAuthenticated()
@UseGuards(CombinedAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

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
    await this.adminService.clearLocal(db);
    return true;
  }
}
