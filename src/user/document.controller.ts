import {
  Controller,
  Get,
  Param,
  Body,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { User } from '../session/session/user-auth.dto';
import { ApiBasicAuth } from '@nestjs/swagger';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { DocumentService } from './document.service';
import { Request } from 'express';
import { BasicAuthGuard } from '../session/guards/basic-auth/basic-auth-guard.service';

/**
 * This controller handles the interaction with the CouchDB _users database.
 * This includes fetching user documents and changing the password of an existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 */
@ApiBasicAuth()
@UseGuards(BasicAuthGuard)
@Controller('/:db')
export class DocumentController {
  constructor(private userService: DocumentService) {}

  /**
   * Fetch a document from a database with basic auth.
   * @param db the name of the database from which the document should be fetched
   * @param docId the name of the document
   * @param request the request object holding the user executing the request
   */
  @Get('/:docId')
  getDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Req() request: Request,
  ): Promise<DatabaseDocument> {
    const authenticatedUser = request.user as User;
    return this.userService.getDocument(db, docId, authenticatedUser);
  }

  /**
   * Update the user document with a new password.
   * Users can only update their own document.
   * @param db the name of the database from which the document should be fetched
   * @param docId the ID of the document which should be stored
   * @param document a object from which only the password property will be used
   * @param request the request object holding the user executing the request
   */
  @Put('/:docId')
  async putDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Body() document: DatabaseDocument,
    @Req() request: Request,
  ): Promise<DocSuccess> {
    const requestingUser = request.user as User;
    return this.userService.putDocument(db, docId, document, requestingUser);
  }
}
