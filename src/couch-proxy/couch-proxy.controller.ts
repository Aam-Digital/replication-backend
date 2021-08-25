import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { catchError, map, Observable } from 'rxjs';
import { UserCredentials, UserResponse } from './couch-interfaces/user-auth';
import { ChangesFeed } from './couch-interfaces/changes';
import {
  RevisionDiffRequest,
  RevisionDiffResponse,
} from './couch-interfaces/revision-diff';
import {
  BulkDocsRequest,
  BulkDocsResponse,
} from './couch-interfaces/bulk-docs';
import { BulkGetRequest, BulkGetResponse } from './couch-interfaces/bulk-get';
import { AllDocsRequest, AllDocsResponse } from './couch-interfaces/all-docs';

@Controller('couchdb/db')
export class CouchProxyController {
  readonly couchDB = 'https://dev.aam-digital.com/db';
  private username: string;
  private password: string;

  constructor(private httpService: HttpService) {}

  /**
   * Login endpoint.
   * Saves username and password and authenticates against the database.
   * @param credentials
   */
  @Post('/_session')
  session(@Body() credentials: UserCredentials): Observable<UserResponse> {
    this.username = credentials.name;
    this.password = credentials.password;
    return this.httpService
      .post(`${this.couchDB}/_session`, {
        name: this.username,
        password: this.password,
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Checks whether the database exists and the user has access to it.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#get-target-information}
   */
  @Get('/')
  getDB(): Observable<any> {
    return this.httpService
      .get(`${this.couchDB}/`, {
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Retrieves the replication logs from the remote database.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#retrieve-replication-logs-from-source-and-target}
   *
   * This may return a 404 Object Not Found error in case no previous replication was done.
   * In this case a full replication is started.
   *
   * @param db name of the database
   * @param id replication id
   */
  @Get('/:db/_local/:id')
  getLocal(@Param('db') db: string, @Param('id') id: string): Observable<any> {
    return this.httpService
      .get(`${this.couchDB}/${db}/_local/${id}`, {
        auth: { username: this.username, password: this.password },
      })
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
   * @param db name of the database
   * @param id identifier of the replication log
   * @param body replication log
   */
  @Put('/:db/_local/:id')
  putLocal(
    @Param('db') db: string,
    @Param('id') id: string,
    @Body() body: any,
  ): Observable<any> {
    return this.httpService
      .put(`${this.couchDB}/${db}/_local/${id}`, body, {
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Listen to the changes feed.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#listen-to-changes-feed}
   * @param db
   * @param queryParams
   * @returns ChangesFeed a list that contains IDs and revision numbers that have been changed.
   */
  @Get('/:db/_changes')
  changes(
    @Param('db') db: string,
    @Query() queryParams: any,
  ): Observable<ChangesFeed> {
    return this.httpService
      .get(`${this.couchDB}/${db}/_changes`, {
        params: queryParams,
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Compare revisions with remote database.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#calculate-revision-difference}
   * @param db name of the database
   * @param body list of documents and their revisions
   * @returns RevisionDiffResponse list of documents and their revisions that are missing in the remote database
   */
  @Post('/:db/_revs_diff')
  revsDiff(
    @Param('db') db: string,
    @Body() body: RevisionDiffRequest,
  ): Observable<RevisionDiffResponse> {
    return this.httpService
      .post(`${this.couchDB}/${db}/_revs_diff`, body, {
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Upload multiple documents with a single request.
   * See {@link https://docs.couchdb.org/en/stable/replication/protocol.html#upload-batch-of-changed-documents}
   *
   * @param db name of the database
   * @param body list of documents to be saved in the remote database
   * @params BulkDocsResponse list of success or error messages regarding the to-be-saved documents
   */
  @Post('/:db/_bulk_docs')
  bulkDocs(
    @Param('db') db: string,
    @Body() body: BulkDocsRequest,
  ): Observable<BulkDocsResponse> {
    return this.httpService
      .post(`${this.couchDB}/${db}/_bulk_docs`, body, {
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Retrieve multiple documents from database.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=bulk_get#post--db-_bulk_get}
   *
   * @param db name of database
   * @param queryParams
   * @param body list of document IDs which should be fetched from the remote database
   * @returns BulkGetResponse list of documents or error messages
   */
  @Post('/:db/_bulk_get')
  bulkPost(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Body() body: BulkGetRequest,
  ): Observable<BulkGetResponse> {
    return this.httpService
      .post(`${this.couchDB}/${db}/_bulk_get`, body, {
        params: queryParams,
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Fetch a bulk of documents specified by the ID's in the body.
   * See {@link https://docs.couchdb.org/en/stable/api/database/bulk-api.html?highlight=all_docs#post--db-_all_docs}
   *
   * @param db remote database
   * @param queryParams
   * @param body a object containing document ID's to be fetched
   * @returns list of documents
   */
  @Post('/:db/_all_docs')
  allDocs(
    @Param('db') db: string,
    @Query() queryParams: any,
    @Body() body: AllDocsRequest,
  ): Observable<AllDocsResponse> {
    return this.httpService
      .post(`${this.couchDB}/${db}/_all_docs`, body, {
        params: queryParams,
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }

  /**
   * Unused?
   * @param db
   * @param queryParams
   */
  @Get('/:db/_bulk_get')
  bulkGet(@Param('db') db: string, @Query() queryParams: any): Observable<any> {
    console.log('GET bulk doc called', db, queryParams);
    return this.httpService
      .get(`${this.couchDB}/${db}/_bulk_get`, {
        params: queryParams,
        auth: { username: this.username, password: this.password },
      })
      .pipe(map((response) => response.data));
  }
}
