import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '../session/session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { firstValueFrom, map } from 'rxjs';
import { CouchDBInteracter } from '../utils/couchdb-interacter';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import {
  DocumentAbility,
  PermissionService,
} from '../permissions/permission/permission.service';
import { permittedFieldsOf } from '@casl/ability/extra';
import * as _ from 'lodash';

@Injectable()
export class DocumentService extends CouchDBInteracter {
  constructor(
    httpService: HttpService,
    configService: ConfigService,
    private permissionService: PermissionService,
  ) {
    super(httpService, configService);
  }

  async getDocument(
    databaseName: string,
    documentID: string,
    requestingUser: User,
  ): Promise<DatabaseDocument> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const document = await this.getDocumentFromDB(databaseName, documentID);
    if (userAbility.can('read', document)) {
      return document;
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  private getDocumentFromDB(databaseName: string, documentID: string) {
    return firstValueFrom(
      this.httpService
        .get<DatabaseDocument>(this.buildDocUrl(databaseName, documentID))
        .pipe(map((response) => response.data)),
    );
  }

  private buildDocUrl(db: string, username: string): string {
    return `${this.databaseUrl}/${db}/${username}`;
  }

  async putDocument(
    databaseName: string,
    documentID: string,
    document: DatabaseDocument,
    requestingUser: User,
  ): Promise<DocSuccess> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const existingDoc = await this.getDocumentFromDB(
      databaseName,
      documentID,
    ).catch(() => undefined); // Doc does not exist
    if (!existingDoc && userAbility.can('create', document)) {
      // Creating
      return this.putDocumentToDB(databaseName, documentID, document);
    } else if (userAbility.can('update', existingDoc)) {
      // Updating
      const finalDoc = this.applyPermissions(
        userAbility,
        existingDoc,
        document,
      );
      return this.putDocumentToDB(databaseName, documentID, finalDoc);
    } else {
      // TODO support 'delete'
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  private putDocumentToDB(
    dbName: string,
    docID: string,
    newUserObject: DatabaseDocument,
  ): Promise<DocSuccess> {
    return firstValueFrom(
      this.httpService
        .put<DocSuccess>(this.buildDocUrl(dbName, docID), newUserObject)
        .pipe(map((response) => response.data)),
    );
  }

  private applyPermissions(
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