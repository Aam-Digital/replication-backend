import { Injectable } from '@nestjs/common';
import {
  BulkGetResponse,
  BulkGetResult,
  OkDoc,
} from '../couch-proxy/couchdb-dtos/bulk-get.dto';
import {
  AllDocsRequest,
  AllDocsResponse,
  DocMetaInf,
} from '../couch-proxy/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/session/user-auth.dto';
import {
  DocumentAbility,
  PermissionService,
} from '../permission/permission.service';
import { HttpService } from '@nestjs/axios';
import { CouchProxyController } from '../couch-proxy/couch-proxy.controller';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, map } from 'rxjs';

@Injectable()
export class DocumentFilterService {
  private readonly databaseEndpoint: string;
  constructor(
    private permissionService: PermissionService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Send the basic auth header with every request
    this.httpService.axiosRef.defaults.auth = {
      username: this.configService.get<string>(
        CouchProxyController.DATABASE_USER_ENV,
      ),
      password: this.configService.get<string>(
        CouchProxyController.DATABASE_PASSWORD_ENV,
      ),
    };
    this.databaseEndpoint =
      this.configService.get<string>(CouchProxyController.DATABASE_URL_ENV) +
      '/' +
      this.configService.get<string>(CouchProxyController.DATABASE_NAME_ENV);
  }

  filterBulkGetResponse(
    response: BulkGetResponse,
    user: User,
  ): BulkGetResponse {
    const ability = this.permissionService.getAbilityFor(user);
    const withPermissions: BulkGetResult[] = response.results.map((result) => {
      return {
        id: result.id,
        docs: result.docs.filter((docResult) => {
          if (docResult.hasOwnProperty('ok')) {
            const document = (docResult as OkDoc).ok;
            return document._deleted || ability.can('read', document);
          } else {
            // error
            return true;
          }
        }),
      };
    });
    // Only return results where at least one document is left
    return {
      results: withPermissions.filter((result) => result.docs.length > 0),
    };
  }

  filterAllDocsResponse(
    response: AllDocsResponse,
    user: User,
  ): AllDocsResponse {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter(
        (row) => row.doc._deleted || ability.can('read', row.doc),
      ),
    };
  }

  async filterBulkDocsRequest(
    request: BulkDocsRequest,
    user: User,
  ): Promise<BulkDocsRequest> {
    const ability = this.permissionService.getAbilityFor(user);
    const allDocsRequest: AllDocsRequest = {
      keys: request.docs.map((doc) => doc._id),
    };
    const response = await firstValueFrom(
      this.httpService
        .post<AllDocsResponse>(
          `${this.databaseEndpoint}/_bulk_get`,
          allDocsRequest,
        )
        .pipe(map((res) => res.data)),
    );
    return {
      new_edits: request.new_edits,
      docs: request.docs.filter((doc) =>
        this.hasPermissionsForDoc(
          doc,
          response.rows.find((responseDoc) => responseDoc.id === doc._id),
          ability,
        ),
      ),
    };
  }

  private hasPermissionsForDoc(
    updatedDoc: DatabaseDocument,
    existingDoc: DocMetaInf,
    ability: DocumentAbility,
  ) {
    if (existingDoc) {
      if (updatedDoc._deleted) {
        return ability.can('delete', existingDoc.doc);
      } else {
        return ability.can('update', existingDoc.doc);
      }
    } else {
      return ability.can('create', updatedDoc);
    }
  }
}
