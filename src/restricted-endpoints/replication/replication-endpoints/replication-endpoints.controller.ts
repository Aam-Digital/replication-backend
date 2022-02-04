import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, from, map, Observable, switchMap } from 'rxjs';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couchdb-dtos/bulk-docs.dto';
import { BulkGetRequest, BulkGetResponse } from './couchdb-dtos/bulk-get.dto';
import { AllDocsRequest, AllDocsResponse } from './couchdb-dtos/all-docs.dto';
import { DocumentFilterService } from '../document-filter/document-filter.service';
import { JwtGuard } from '../../../auth/guards/jwt/jwt.guard';
import { User } from '../../session/user-auth.dto';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { CouchDBInteracter } from '../../../utils/couchdb-interacter';
import { ApiOperation } from '@nestjs/swagger';

@UseGuards(JwtGuard)
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
    const user = request.user as User;
    return this.httpService
      .get<AllDocsResponse>(
        `${this.databaseUrl}/${this.databaseName}/_all_docs`,
        { params: queryParams },
      )
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
   * This function should be called whenever the permissions change to re-trigger sync
   * TODO do this automatically
   * TODO move this out
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
