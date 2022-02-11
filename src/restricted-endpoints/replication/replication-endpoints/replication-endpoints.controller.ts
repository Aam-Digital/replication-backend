import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, from, map, Observable, switchMap } from 'rxjs';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetRequest, BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsRequest, AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { User } from '../../session/user-auth.dto';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';
import { ApiOperation } from '@nestjs/swagger';

@Controller()
export class ReplicationEndpointsController extends CouchDBInteracter {
  constructor(
    httpService: HttpService,
    configService: ConfigService,
    private documentFilter: DocumentFilterService,
  ) {
    super(httpService, configService);
  }
  /**
   * Upload multiple documents with a single request.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents}
   *
   * @param db name of the database to which the documents should be uploaded
   * @param body list of documents to be saved in the remote database
   * @param request holding information about the current user
   * @returns BulkDocsResponse list of success or error messages regarding the to-be-saved documents
   */
  @Post('/:db/_bulk_docs')
  @ApiOperation({
    description: `Upload multiple documents with a single request.\n\ncaveats: only works with ?include_docs=true`,
  })
  bulkDocs(
    @Param('db') db: string,
    @Body() body: BulkDocsRequest,
    @Req() request: Request,
  ): Observable<BulkDocsResponse> {
    const user = request.user as User;
    return from(this.documentFilter.filterBulkDocsRequest(body, user, db)).pipe(
      switchMap((filteredBody) =>
        this.httpService.post(
          `${this.databaseUrl}/${db}/_bulk_docs`,
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
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param body list of document IDs which should be fetched from the remote database
   * @param request holding information about the current user
   * @returns BulkGetResponse list of documents or error messages
   */
  @Post('/:db/_bulk_get')
  bulkGetPost(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Body() body: BulkGetRequest,
    @Req() request: Request,
  ): Observable<BulkGetResponse> {
    const user = request.user as User;
    return this.httpService
      .post<BulkGetResponse>(`${this.databaseUrl}/${db}/_bulk_get`, body, {
        params: queryParams,
      })
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
   * @param db name of the database from which the documents are fetched
   * @param queryParams
   * @param request holding information about the current user
   * @param body a object containing document ID's to be fetched
   * @returns list of documents
   */
  @Post('/:db/_all_docs')
  allDocs(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Req() request: Request,
    @Body() body: AllDocsRequest,
  ): Observable<AllDocsResponse> {
    const user = request.user as User;
    return this.httpService
      .post<AllDocsResponse>(`${this.databaseUrl}/${db}/_all_docs`, body, {
        params: queryParams,
      })
      .pipe(
        map((response) => response.data),
        map((response) =>
          this.documentFilter.filterAllDocsResponse(response, user),
        ),
      );
  }

  @Get('/:db/_all_docs')
  allDocsGet(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Req() request: Request,
  ) {
    const user = request.user as User;
    return this.httpService
      .get<AllDocsResponse>(`${this.databaseUrl}/${db}/_all_docs`, {
        params: queryParams,
      })
      .pipe(
        map((response) => response.data),
        map((response) =>
          this.documentFilter.filterAllDocsResponse(response, user),
        ),
      );
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
   * TODO do this automatically
   * TODO move this out
   */
  @Post('/:db/clear_local')
  async clearLocal(@Param('db') db: string): Promise<any> {
    const localDocsResponse = await firstValueFrom(
      this.httpService
        .get<AllDocsResponse>(`${this.databaseUrl}/${db}/_local_docs`)
        .pipe(map((response) => response.data)),
    );

    // Get IDs of the replication checkpoints
    const ids = localDocsResponse.rows
      .map((doc) => doc.id)
      .filter(
        (id) => !id.includes('purge-mrview') && !id.includes('shard-sync'),
      );
    const deletePromises = ids.map((id) =>
      firstValueFrom(
        this.httpService.delete(`${this.databaseUrl}/${db}/${id}`),
      ),
    );

    await Promise.all(deletePromises);
    return true;
  }
}
