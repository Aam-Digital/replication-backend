import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserInfo } from '../session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { DocumentService } from './document.service';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../auth/user.decorator';
import { QueryParams } from '../replication/bulk-document/couchdb-dtos/document.dto';

/**
 * This controller implements endpoints to interact with single documents of a database.
 * This can be used to create, update, read documents from any database.
 * This includes fetching user documents and changing the password of an existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 *
 * TODO DELETE is not supported yet
 */
@UseGuards(CombinedAuthGuard)
@Controller('/:db/:docId')
export class DocumentController {
  constructor(private documentService: DocumentService) {}

  /**
   * Fetch a document from a database with basic auth.
   * See {@link https://docs.couchdb.org/en/stable/api/document/common.html?highlight=put%20document#get--db-docid}
   * @param db the name of the database from which the document should be fetched
   * @param docId the name of the document
   * @param user logged in user
   * @param queryParams additional params that will be forwarded
   */
  @Get()
  getDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @User() user: UserInfo,
    @Query() queryParams: any,
  ): Promise<DatabaseDocument> {
    return this.documentService.getDocument(db, docId, user, queryParams);
  }

  /**
   * Put a document into the specified database using basic auth.
   * See {@link https://docs.couchdb.org/en/stable/api/document/common.html?highlight=put%20document#put--db-docid}
   * @param db the name of the database where the document should be put
   * @param docId the ID of the document which should be put
   * @param document the document to be put. This doc does not necessarily need a _id field.
   * @param user logged in user
   */
  @Put()
  async putDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @Body() document: DatabaseDocument,
    @User() user: UserInfo,
  ): Promise<DocSuccess> {
    document._id = docId;
    return this.documentService.putDocument(db, document, user);
  }

  /**
   * Delete a document from the specified database using basic auth.
   * See {@ling https://docs.couchdb.org/en/stable/api/document/common.html#delete--db-docid}
   * @param db the name of the database from which the document should be fetched
   * @param docId the name of the document
   * @param user logged in user
   * @param queryParams additional params that will be forwarded
   */
  @Delete()
  async deleteDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @User() user: UserInfo,
    @Query() queryParams?: QueryParams,
    // This is just for the Swagger interface
  ) {
    return this.documentService.deleteDocument(db, docId, user, queryParams);
  }
}
