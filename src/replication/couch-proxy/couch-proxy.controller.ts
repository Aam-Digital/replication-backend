import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import {
  catchError,
  firstValueFrom,
  from,
  map,
  Observable,
  switchMap,
} from 'rxjs';
import { ChangesFeed } from './couchdb-dtos/changes.dto';
import {
  RevisionDiffRequest,
  RevisionDiffResponse,
} from './couchdb-dtos/revision-diff.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetRequest, BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsRequest, AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { JwtGuard } from '../../session/guards/jwt/jwt.guard';
import { User } from '../../session/session/user-auth.dto';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';
import { ApiOperation } from '@nestjs/swagger';

@UseGuards(JwtGuard)
@Controller()
export class CouchProxyController extends CouchDBInteracter {
  constructor(
    httpService: HttpService,
    configService: ConfigService,
    private documentFilter: DocumentFilterService,
  ) {
    super(httpService, configService);
  }

  /**
   * Checks whether the database exists and the user has access to it.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#get-target-information}
   */
  @Get('/')
  getRoot(): Observable<any> {
    return this.httpService
      .get(`${this.databaseUrl}/`)
      .pipe(map((response) => response.data));
  }

  /**
   * Retrieves the replication logs from the remote database.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#retrieve-replication-logs-from-source-and-target}
   *
   * This may return a 404 Object Not Found error in case no previous replication was done.
   * In this case a full replication is started.
   *
   * @param id replication id
   */
  @Get('/:db/_local/:id')
  getLocal(@Param('id') id: string): Observable<any> {
    return this.httpService
      .get(`${this.databaseUrl}/${this.databaseName}/_local/${id}`)
      .pipe(
        catchError((err) => {
          throw new NotFoundException(err.request.data);
        }),
        map((response) => response.data),
      );
  }

  /**
   * Store new replication log on the remote database.
   * See {@link https://docs.couchdb.org/en/stable/api/local.html#put--db-_local-docid}
   *
   * @param id identifier of the replication log
   * @param body replication log
   */
  @Put('/:db/_local/:id')
  putLocal(@Param('id') id: string, @Body() body: any): Observable<any> {
    return this.httpService
      .put(`${this.databaseUrl}/${this.databaseName}/_local/${id}`, body)
      .pipe(map((response) => response.data));
  }

  /**
   * Listen to the changes feed.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#listen-to-changes-feed}
   * @param queryParams
   * @returns ChangesFeed a list that contains IDs and revision numbers that have been changed.
   */
  @Get('/:db/_changes')
  changes(@Query() queryParams: any): Observable<ChangesFeed> {
    return this.httpService
      .get(`${this.databaseUrl}/${this.databaseName}/_changes`, {
        params: queryParams,
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Compare revisions with remote database.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#calculate-revision-difference}
   * @param body list of documents and their revisions
   * @returns RevisionDiffResponse list of documents and their revisions that are missing in the remote database
   */
  @Post('/:db/_revs_diff')
  revsDiff(
    @Body() body: RevisionDiffRequest,
  ): Observable<RevisionDiffResponse> {
    return this.httpService
      .post(`${this.databaseUrl}/${this.databaseName}/_revs_diff`, body)
      .pipe(map((response) => response.data));
  }

  /**
   * Upload multiple documents with a single request.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents}
   *
   * @param body list of documents to be saved in the remote database
   * @param request holding information about the current user
   * @returns BulkDocsResponse list of success or error messages regarding the to-be-saved documents
   */
  @Post('/:db/_bulk_docs')
  @ApiOperation({
    description: `Upload multiple documents with a single request.\n\ncaveats: only works with ?include_docs=true`,
  })
  bulkDocs(
    @Body() body: BulkDocsRequest,
    @Req() request: Request,
  ): Observable<BulkDocsResponse> {
    const user = request.user as User;
    return from(this.documentFilter.filterBulkDocsRequest(body, user)).pipe(
      switchMap((filteredBody) =>
        this.httpService.post(
          `${this.databaseUrl}/${this.databaseName}/_bulk_docs`,
          filteredBody,
        ),
      ),
      map((response) => response.data),
    );
  }

  /**
   * Retrieve multiple documents from database.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=bulk_get#post--db-_bulk_get}
   *
   * @param queryParams
   * @param body list of document IDs which should be fetched from the remote database
   * @param request holding information about the current user
   * @returns BulkGetResponse list of documents or error messages
   */
  @Post('/:db/_bulk_get')
  bulkGetPost(
    @Query() queryParams: any,
    @Body() body: BulkGetRequest,
    @Req() request: Request,
  ): Observable<BulkGetResponse> {
    const user = request.user as User;
    return this.httpService
      .post<BulkGetResponse>(
        `${this.databaseUrl}/${this.databaseName}/_bulk_get`,
        body,
        { params: queryParams },
      )
      .pipe(
        map((response) => response.data),
        map((response) =>
          this.documentFilter.filterBulkGetResponse(response, user),
        ),
      );
  }

  /**
   * Fetch a bulk of documents specified by the ID's in the body.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=all_docs#post--db-_all_docs}
   *
   * @param queryParams
   * @param request holding information about the current user
   * @param body (optional) a object containing document ID's to be fetched
   * @returns list of documents
   */
  @Post('/:db/_all_docs')
  allDocs(
    @Query() queryParams: any,
    @Req() request: Request,
    @Body() body?: AllDocsRequest,
  ): Observable<AllDocsResponse> {
    const user = request.user as User;
    return this.httpService
      .post<AllDocsResponse>(
        `${this.databaseUrl}/${this.databaseName}/_all_docs`,
        body,
        { params: queryParams },
      )
      .pipe(
        map((response) => response.data),
        map((response) =>
          this.documentFilter.filterAllDocsResponse(response, user),
        ),
      );
  }

  @Get('/:db/_all_docs')
  allDocsGet(@Query() queryParams: any, @Req() request: Request) {
    return this.allDocs(queryParams, request);
  }

  /**
   * Deletes all local documents of the remote database.
   * These document hold meta-information about the replication process.
   * Deleting them forces clients to re-run sync and check which documents are different.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#retrieve-replication-logs-from-source-and-target}
   *
   * This function should be called whenever the permissions change to re-trigger sync
   * TODO do this automatically
   */
  @Post('/clear_local')
  async clearLocal(): Promise<any> {
    const localDocsResponse = await firstValueFrom(
      this.httpService
        .get<AllDocsResponse>(
          `${this.databaseUrl}/${this.databaseName}/_local_docs`,
        )
        .pipe(map((response) => response.data)),
    );
    const ids = localDocsResponse.rows.map((doc) => doc.id);
    const deletePromises = ids.map((id) =>
      firstValueFrom(
        this.httpService.delete(
          `${this.databaseUrl}/${this.databaseName}/${id}`,
        ),
      ),
    );
    await Promise.all(deletePromises);
    return true;
  }
}
