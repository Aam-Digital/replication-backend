import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { UserInfo } from '../session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../auth/user.decorator';
import { QueryParams } from '../replication/bulk-document/couchdb-dtos/document.dto';
import { CouchdbService } from '../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { firstValueFrom } from 'rxjs';
import { permittedFieldsOf } from '@casl/ability/extra';
import { pick } from 'lodash';

/**
 * This controller implements endpoints to interact with single documents of a database.
 * This can be used to create, update, read documents from any database.
 * This includes fetching user documents and changing the password of an existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 */
@UseGuards(CombinedAuthGuard)
@Controller('/:db/:docId')
export class DocumentController {
  constructor(
    private couchdbService: CouchdbService,
    private permissionService: PermissionService,
  ) {}

  /**
   * Fetch a document from a database with basic auth.
   * See {@link https://docs.couchdb.org/en/stable/api/document/common.html?highlight=put%20document#get--db-docid}
   * @param db the name of the database from which the document should be fetched
   * @param docId the name of the document
   * @param user logged in user
   * @param queryParams additional params that will be forwarded
   */
  @Get()
  async getDocument(
    @Param('db') db: string,
    @Param('docId') docId: string,
    @User() user: UserInfo,
    @Query() queryParams?: any,
  ): Promise<DatabaseDocument> {
    const userAbility = this.permissionService.getAbilityFor(user);
    const document = await firstValueFrom(
      this.couchdbService.get(db, docId, queryParams),
    );
    if (userAbility.can('read', document)) {
      return document;
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
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
    const userAbility = this.permissionService.getAbilityFor(user);
    const existingDoc = await firstValueFrom(
      this.couchdbService.get(db, docId),
    ).catch(() => undefined); // Doc does not exist

    if (!existingDoc && userAbility.can('create', document)) {
      // Creating
      return firstValueFrom(this.couchdbService.put(db, document));
    } else if (userAbility.can('update', existingDoc)) {
      // Updating
      const finalDoc = this.applyPermissions(
        userAbility,
        existingDoc,
        document,
      );
      return firstValueFrom(this.couchdbService.put(db, finalDoc));
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
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
  ) {
    const userAbility = this.permissionService.getAbilityFor(user);
    const document = await firstValueFrom(
      this.couchdbService.get(db, docId, queryParams),
    );
    if (userAbility.can('delete', document)) {
      return firstValueFrom(this.couchdbService.delete(db, docId, queryParams));
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  /**
   * Selectively apply changed properties only if the user has permissions for that specific property.
   *
   * Properties that the given user is not allowed to change are simply omitted, no error is thrown if trying to change them.
   *
   * @param userAbility
   * @param oldDoc
   * @param newDoc
   * @private
   */
  private applyPermissions(
    // TODO: (property-based write) what about bulkPost writes in replication-endpoint - they should also use these rules?
    userAbility: DocumentAbility,
    oldDoc: DatabaseDocument,
    newDoc: DatabaseDocument,
  ): DatabaseDocument {
    const permittedFields = permittedFieldsOf(userAbility, 'update', oldDoc, {
      fieldsFrom: (rule) => rule.fields || [],
    });
    if (permittedFields.length > 0) {
      // Updating some properties
      const updatedFields = pick(newDoc, permittedFields);
      return Object.assign(oldDoc, updatedFields);
    } else {
      // Updating whole document
      return newDoc;
    }
  }
}
