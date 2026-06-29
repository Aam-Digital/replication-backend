import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { from, Observable } from 'rxjs';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import {
  JsonArrayFilterTransform,
  jsonTokenParser,
} from '../../../common/json-array-filter';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import { UserInfo } from '../../session/user-auth.dto';
import { BulkDocumentService } from './bulk-document.service';
import { AllDocsRequest } from './couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetRequest } from './couchdb-dtos/bulk-get.dto';

/**
 * Handle endpoints for the CouchDB replication process and bulk actions
 * which are required by PouchDB.
 *
 * Enforces permissions of the current user, filtering requests and responses
 * between the connected CouchDB server and the client.
 *
 * Large read responses (_all_docs, _bulk_get, _find) are *streamed*:
 * the CouchDB response is parsed and permission-filtered incrementally and
 * forwarded to the client without buffering the whole payload (#109).
 */
@UseGuards(CombinedAuthGuard)
@Controller()
export class BulkDocEndpointsController {
  private readonly logger = new Logger(BulkDocEndpointsController.name);

  constructor(
    private readonly couchdbService: CouchdbService,
    private readonly bulkDocumentService: BulkDocumentService,
  ) {}

  /**
   * Upload multiple documents with a single request.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents}
   *
   * @param db name of the database to which the documents should be uploaded
   * @param body list of documents to be saved in the remote database
   * @param user logged in user
   * @returns BulkDocsResponse list of success or error messages regarding the to-be-saved documents
   */
  // TODO(#274): denied docs are silently dropped rather than returning forbidden error entries per input;
  // this breaks the CouchDB one-result-per-input contract and may cause PouchDB retry churn
  // https://github.com/Aam-Digital/replication-backend/issues/274
  @Post('/:db/_bulk_docs')
  @ApiOperation({
    description: `Upload multiple documents with a single request.\n\ncaveats: only works with ?include_docs=true`,
  })
  bulkDocs(
    @Param('db') db: string,
    @Body() body: BulkDocsRequest,
    @User() user: UserInfo,
  ): Observable<BulkDocsResponse> {
    return from(this.bulkDocumentService.handleBulkDocs(body, user, db));
  }

  /**
   * Find documents using a declarative JSON querying syntax.
   * The response is permission-filtered and streamed.
   * See {@link https://docs.couchdb.org/en/stable/api/database/find.html#post--db-_find}
   *
   * @param db name of the database to query
   * @param body search query object
   * @param user logged in user
   * @param res
   */
  @Post('/:db/_find')
  @ApiOperation({
    description: `Find documents using a declarative JSON querying syntax.`,
  })
  async find(
    @Param('db') db: string,
    @Body() body: object,
    @User() user: UserInfo,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.couchdbService.postStream(db, '_find', body);
    const isPermitted = this.bulkDocumentService.findDocFilter(user);
    await this.streamFiltered(
      source,
      'docs',
      (doc) => (isPermitted(doc) ? doc : undefined),
      res,
    );
  }

  /**
   * Retrieve multiple documents from database.
   * The response is permission-filtered and streamed.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=bulk_get#post--db-_bulk_get}
   *
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param body list of document IDs which should be fetched from the remote database
   * @param user logged in user
   * @param res
   */
  @Post('/:db/_bulk_get')
  async bulkGetPost(
    @Param('db') db: string,
    @Query() queryParams: Record<string, string>,
    @Body() body: BulkGetRequest,
    @User() user: UserInfo,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.couchdbService.postStream(
      db,
      '_bulk_get',
      body,
      queryParams,
    );
    await this.streamFiltered(
      source,
      'results',
      this.bulkDocumentService.bulkGetResultMapper(user),
      res,
    );
  }

  /**
   * Fetch a bulk of documents specified by the ID's in the body.
   * The response is permission-filtered and streamed.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=all_docs#post--db-_all_docs}
   *
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param user logged in user
   * @param body a object containing document ID's to be fetched
   * @param res
   */
  @Post('/:db/_all_docs')
  async allDocs(
    @Param('db') db: string,
    @Query() queryParams: Record<string, string>,
    @User() user: UserInfo,
    @Body() body: AllDocsRequest,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.couchdbService.postStream(
      db,
      '_all_docs',
      body,
      queryParams,
    );
    await this.streamAllDocs(source, user, res);
  }

  @Get('/:db/_all_docs')
  async allDocsGet(
    @Param('db') db: string,
    @Query() queryParams: Record<string, string>,
    @User() user: UserInfo,
    @Res() res: Response,
  ): Promise<void> {
    const source = await this.couchdbService.getStream(
      db,
      '_all_docs',
      queryParams,
    );
    await this.streamAllDocs(source, user, res);
  }

  private async streamAllDocs(source: Readable, user: UserInfo, res: Response) {
    const isPermitted = this.bulkDocumentService.allDocsRowFilter(user);
    await this.streamFiltered(
      source,
      'rows',
      (row) => (isPermitted(row) ? row : undefined),
      res,
    );
  }

  /**
   * Incrementally parse the CouchDB response stream, filter/transform the
   * items of `arrayField` and forward the re-serialized JSON to the client.
   *
   * Errors that occur *before* the first byte was sent result in a regular
   * error response. Errors after that abort the connection so the client
   * sees a truncated response (and e.g. PouchDB retries) instead of
   * mistaking a partial payload for a complete one.
   */
  private async streamFiltered(
    source: Readable,
    arrayField: string,
    mapItem: (item: any) => unknown | undefined,
    res: Response,
  ): Promise<void> {
    res.status(200);
    res.setHeader('content-type', 'application/json');
    try {
      await pipeline(
        source,
        jsonTokenParser(),
        new JsonArrayFilterTransform({ arrayField, mapItem }),
        res,
      );
    } catch (error) {
      if (!res.headersSent) {
        throw error;
      }
      this.logger.warn(
        `aborting streamed response after error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      res.destroy();
    }
  }
}
