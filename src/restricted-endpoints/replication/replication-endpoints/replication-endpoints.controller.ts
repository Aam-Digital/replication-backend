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
import { from, map, Observable, switchMap } from 'rxjs';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetRequest, BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsRequest, AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { BulkDocumentService } from '../bulk-document/bulk-document.service';
import { UserInfo } from '../../session/user-auth.dto';
import { ApiOperation } from '@nestjs/swagger';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { User } from '../../../auth/user.decorator';
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
export class ReplicationEndpointsController {
  constructor(
    private couchdbService: CouchdbService,
    private documentFilter: BulkDocumentService,
  ) {}

  /**
   * return information on the whole CouchDB
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

  /**
   * Upload multiple documents with a single request.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents}
   *
   * @param db name of the database to which the documents should be uploaded
   * @param body list of documents to be saved in the remote database
   * @param user logged in user
   * @returns BulkDocsResponse list of success or error messages regarding the to-be-saved documents
   */
  @Post('/:db/_bulk_docs')
  @ApiOperation({
    description: `Upload multiple documents with a single request.\n\ncaveats: only works with ?include_docs=true`,
  })
  bulkDocs(
    @Param('db') db: string,
    @Body() body: BulkDocsRequest,
    @User() user: UserInfo,
  ): Observable<BulkDocsResponse> {
    return from(this.documentFilter.filterBulkDocsRequest(body, user, db)).pipe(
      switchMap((filteredBody) =>
        this.couchdbService.post<BulkDocsResponse>(
          db,
          '_bulk_docs',
          filteredBody,
        ),
      ),
    );
  }

  /**
   * Retrieve multiple documents from database.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=bulk_get#post--db-_bulk_get}
   *
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param body list of document IDs which should be fetched from the remote database
   * @param user logged in user
   * @returns BulkGetResponse list of documents or error messages
   */
  @Post('/:db/_bulk_get')
  bulkGetPost(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Body() body: BulkGetRequest,
    @User() user: UserInfo,
  ): Observable<BulkGetResponse> {
    return this.couchdbService
      .post<BulkGetResponse>(db, '_bulk_get', body, queryParams)
      .pipe(
        map((response) =>
          this.documentFilter.filterBulkGetResponse(response, user),
        ),
      );
  }

  /**
   * Fetch a bulk of documents specified by the ID's in the body.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=all_docs#post--db-_all_docs}
   *
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param user logged in user
   * @param body a object containing document ID's to be fetched
   * @returns list of documents
   */
  @Post('/:db/_all_docs')
  allDocs(
    @Param('db') db: string,
    @Query() queryParams: any,
    @User() user: UserInfo,
    @Body() body: AllDocsRequest,
  ): Observable<AllDocsResponse> {
    return this.couchdbService
      .post<AllDocsResponse>(db, '_all_docs', body, queryParams)
      .pipe(
        map((response) =>
          this.documentFilter.filterAllDocsResponse(response, user),
        ),
      );
  }

  @Get('/:db/_all_docs')
  allDocsGet(
    @Param('db') db: string,
    @Query() queryParams: any,
    @User() user: UserInfo,
  ) {
    return this.couchdbService
      .get<AllDocsResponse>(db, '_all_docs', queryParams)
      .pipe(
        map((response) =>
          this.documentFilter.filterAllDocsResponse(response, user),
        ),
      );
  }
}
