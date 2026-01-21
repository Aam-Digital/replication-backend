import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';

/**
 * Handle endpoints for the CouchDB replication process and bulk actions
 * which are required by PouchDB.
 *
 * Enforces permissions of the current user, filtering requests and responses
 * between the connected CouchDB server and the client.
 */
@UseGuards(CombinedAuthGuard)
@Controller()
export class InfoEndpointsController {
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
   * can be accessed without logging in
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
}
