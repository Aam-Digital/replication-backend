import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../../../auth/only-authenticated.decorator';

/**
 * Handle endpoints for the CouchDB replication process and bulk actions
 * which are required by PouchDB.
 *
 * Enforces permissions of the current user, filtering requests and responses
 * between the connected CouchDB server and the client.
 */
@OnlyAuthenticated()
@UseGuards(CombinedAuthGuard)
@Controller()
export class ReplicationEndpointsController {
  constructor(private couchdbService: CouchdbService) {}

  /**
   * return information on the whole CouchDB
   * can be accessed without logging in
   */
  @Get()
  couchDBInfo() {
    return this.couchdbService.get();
  }

  /**
   * returns information about a single DB
   * @param db
   */
  @Get([':db'])
  dbInfo(@Param('db') db: string) {
    return this.couchdbService.get(db);
  }

  /**
   * Reads a local document (which are not synced)
   * @param db
   * @param docId
   */
  @Get(':db/_local/:docId')
  getLocalDoc(@Param('db') db: string, @Param('docId') docId: string) {
    return this.couchdbService.get(db, `_local/${docId}`);
  }

  /**
   * Updated a local document
   * @param db
   * @param docId
   * @param body
   */
  @Put(':db/_local/:docId')
  putLocalDoc(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Body() body,
  ) {
    return this.couchdbService.put(db, body);
  }

  /**
   * Get changes for a set of revs
   * @param db
   * @param body
   */
  @Post(':db/_revs_diff')
  revsDiff(@Param('db') db: string, @Body() body) {
    return this.couchdbService.post(db, '_revs_diff', body);
  }

  /**
   * Get the changes stream.
   * The `include_docs` params is automatically set to false.
   * @param db
   * @param params
   */
  @Get(':db/_changes')
  changes(@Param('db') db: string, @Query() params) {
    return this.couchdbService.get(db, '_changes', {
      ...params,
      include_docs: false,
    });
  }
}
