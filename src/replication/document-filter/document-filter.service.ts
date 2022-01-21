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
} from '../../permissions/permission/permission.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, map } from 'rxjs';
import { CouchDBInteracter } from '../../utils/couchdb-interacter';

@Injectable()
export class DocumentFilterService extends CouchDBInteracter {
  constructor(
    private permissionService: PermissionService,
    httpService: HttpService,
    configService: ConfigService,
  ) {
    super(httpService, configService);
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
          `${this.databaseUrl}/${this.databaseName}/_all_docs`,
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
