import { Controller, Get, Param, Body, Put, Req, Query } from '@nestjs/common';
import { User } from '../session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { DocumentService } from './document.service';
import { Request } from 'express';

/**
 * This controller implements endpoints to interact with single documents of a database.
 * This can be used to create, update, read documents from any database.
 * This includes fetching user documents and changing the password of an existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 *
 * TODO DELETE is not supported yet
 */
@Controller('/:db')
export class DocumentController {
  constructor(private documentService: DocumentService) {}

  /**
   * Fetch a document from a database with basic auth.
   * See {@link https://docs.couchdb.org/en/stable/api/document/common.html?highlight=put%20document#get--db-docid}
   * @param db the name of the database from which the document should be fetched
   * @param docId the name of the document
   * @param request the request object holding the user executing the request
   * @param queryParams additional params that will be forwarded
   */
  @Get('/:docId')
  getDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Req() request: Request,
    @Query() queryParams: any,
  ): Promise<DatabaseDocument> {
    const authenticatedUser = request.user as User;
    return this.documentService.getDocument(
      db,
      docId,
      authenticatedUser,
      queryParams,
    );
  }

  /**
   * Put a document into the specified database using basic auth.
   * See {@link https://docs.couchdb.org/en/stable/api/document/common.html?highlight=put%20document#put--db-docid}
   * @param db the name of the database where the document should be put
   * @param docId the ID of the document which should be put
   * @param document the document to be put. This doc does not necessarily need a _id field.
   * @param request the request object holding the user executing the request
   */
  @Put('/:docId')
  async putDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Body() document: DatabaseDocument,
    @Req() request: Request,
  ): Promise<DocSuccess> {
    document._id = docId;
    const requestingUser = request.user as User;
    return this.documentService.putDocument(db, document, requestingUser);
  }
}
