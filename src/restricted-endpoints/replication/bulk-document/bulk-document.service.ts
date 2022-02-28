import { Injectable } from '@nestjs/common';
import {
  BulkGetResponse,
  BulkGetResult,
  ErrorDoc,
  OkDoc,
} from '../replication-endpoints/couchdb-dtos/bulk-get.dto';
import {
  AllDocsRequest,
  AllDocsResponse,
  DocMetaInf,
} from '../replication-endpoints/couchdb-dtos/all-docs.dto';
import {
  BulkDocsRequest,
  DatabaseDocument,
} from '../replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { User } from '../../session/user-auth.dto';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { firstValueFrom } from 'rxjs';
import { Ability } from '@casl/ability';
import { CouchdbService } from '../../../couchdb/couchdb.service';

/**
 * Handle bulk document requests with the remote CouchDB server
 * enforcing the permissions of the given user.
 */
@Injectable()
export class BulkDocumentService {
  constructor(
    private permissionService: PermissionService,
    private couchdbService: CouchdbService,
  ) {}

  filterBulkGetResponse(
    response: BulkGetResponse,
    user: User,
  ): BulkGetResponse {
    const ability = this.permissionService.getAbilityFor(user);
    const withPermissions: BulkGetResult[] = response.results.map((result) => ({
      id: result.id,
      docs: result.docs.filter((doc) =>
        this.isPermittedBulkGetDoc(doc, ability),
      ),
    }));
    // Only return results where at least one document is left
    return {
      results: withPermissions.filter((result) => result.docs.length > 0),
    };
  }

  private isPermittedBulkGetDoc(docResult: OkDoc | ErrorDoc, ability: Ability) {
    if (docResult.hasOwnProperty('ok')) {
      const document = (docResult as OkDoc).ok;
      return document._deleted || ability.can('read', document);
    } else {
      // error - always return these
      return true;
    }
  }

  filterAllDocsResponse(
    response: AllDocsResponse,
    user: User,
  ): AllDocsResponse {
    const ability = this.permissionService.getAbilityFor(user);
    return {
      total_rows: response.total_rows,
      offset: response.offset,
      rows: response.rows.filter((row) =>
        row.doc ? row.doc._deleted || ability.can('read', row.doc) : true,
      ),
    };
  }

  async filterBulkDocsRequest(
    request: BulkDocsRequest,
    user: User,
    db: string,
  ): Promise<BulkDocsRequest> {
    const ability = this.permissionService.getAbilityFor(user);
    const allDocsRequest: AllDocsRequest = {
      keys: request.docs.map((doc) => doc._id),
    };
    const response = await firstValueFrom(
      this.couchdbService.post<AllDocsResponse>(
        db,
        '_all_docs',
        allDocsRequest,
        {
          include_docs: true,
        },
      ),
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
