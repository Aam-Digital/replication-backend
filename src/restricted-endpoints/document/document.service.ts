import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserInfo } from '../session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { firstValueFrom } from 'rxjs';
import {
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { permittedFieldsOf } from '@casl/ability/extra';
import * as _ from 'lodash';
import { CouchdbService } from '../../couchdb/couchdb.service';

/**
 * Read and write individual documents with the remote CouchDB server
 * enforcing the permissions of the given user.
 */
@Injectable()
export class DocumentService {
  constructor(
    private couchdbService: CouchdbService,
    private permissionService: PermissionService,
  ) {}

  async getDocument(
    databaseName: string,
    documentID: string,
    requestingUser: UserInfo,
    queryParams?: any,
  ): Promise<DatabaseDocument> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const document = await firstValueFrom(
      this.couchdbService.get(databaseName, documentID, queryParams),
    );
    if (userAbility.can('read', document)) {
      return document;
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  async putDocument(
    databaseName: string,
    document: DatabaseDocument,
    requestingUser: UserInfo,
  ): Promise<DocSuccess> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const existingDoc = await firstValueFrom(
      this.couchdbService.get(databaseName, document._id),
    ).catch(() => undefined); // Doc does not exist

    if (!existingDoc && userAbility.can('create', document)) {
      // Creating
      return firstValueFrom(this.couchdbService.putDoc(databaseName, document));
    } else if (userAbility.can('update', existingDoc)) {
      // Updating
      const finalDoc = this.applyPermissions(
        userAbility,
        existingDoc,
        document,
      );
      return firstValueFrom(this.couchdbService.putDoc(databaseName, finalDoc));
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
      const updatedFields = _.pick(newDoc, permittedFields);
      return Object.assign(oldDoc, updatedFields);
    } else {
      // Updating whole document
      return newDoc;
    }
  }
}
