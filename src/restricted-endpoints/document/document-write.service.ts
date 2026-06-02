import { Injectable, UnauthorizedException } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { permittedFieldsOf } from '@casl/ability/extra';
import { pick } from 'lodash';
import { CouchdbService } from '../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../permissions/permission/permission.service';
import { AuditService } from '../../audit/audit.service';
import { UserInfo } from '../session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { QueryParams } from '../replication/bulk-document/couchdb-dtos/document.dto';

/**
 * Performs single-document writes (PUT / DELETE) against CouchDB, enforcing
 * permissions and recording an audit entry for each successful write.
 *
 * Extracted from the controller so the component that performs the write also
 * triggers the audit ("the writer audits"), keeping the before-state inside
 * the service and mirroring the bulk write path.
 */
@Injectable()
export class DocumentWriteService {
  constructor(
    private readonly couchdbService: CouchdbService,
    private readonly permissionService: PermissionService,
    private readonly auditService: AuditService,
  ) {}

  async putDocument(
    db: string,
    docId: string,
    document: DatabaseDocument,
    user: UserInfo,
    ifMatch?: string,
  ): Promise<DocSuccess> {
    document._id = docId;

    const existingDoc = await firstValueFrom(
      this.couchdbService.get(db, docId),
    ).catch(() => undefined); // Doc does not exist

    // Deep-clone the before-state NOW: applyPermissions mutates existingDoc in
    // place into the final doc, which would otherwise corrupt the audit diff.
    const beforeDoc = existingDoc ? structuredClone(existingDoc) : undefined;

    if (!existingDoc) {
      // Creating
      if (
        !(await this.permissionService.isAllowedTo(
          'create',
          document,
          user,
          db,
        ))
      ) {
        throw new UnauthorizedException(
          'unauthorized',
          'User is not permitted',
        );
      }

      const result = await firstValueFrom(
        this.couchdbService.put(db, document),
      );
      await this.auditService.record(
        db,
        [{ newDoc: document, newRev: result.rev, operation: 'create' }],
        user,
      );
      return result;
    }

    // Updating
    if (
      !(await this.permissionService.isAllowedTo(
        'update',
        existingDoc,
        user,
        db,
      ))
    ) {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }

    const finalDoc = this.applyPermissions(
      this.permissionService.getAbilityFor(user),
      existingDoc,
      document,
    );
    if (ifMatch) {
      document._rev = ifMatch;
    }
    const result = await firstValueFrom(this.couchdbService.put(db, finalDoc));
    await this.auditService.record(
      db,
      [
        {
          existingDoc: beforeDoc,
          newDoc: finalDoc,
          newRev: result.rev,
          operation: 'update',
        },
      ],
      user,
    );
    return result;
  }

  async deleteDocument(
    db: string,
    docId: string,
    user: UserInfo,
    queryParams?: QueryParams,
  ): Promise<DocSuccess> {
    const document = await firstValueFrom(
      this.couchdbService.get(db, docId, queryParams),
    );

    if (
      !(await this.permissionService.isAllowedTo('delete', document, user, db))
    ) {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }

    const result: DocSuccess = await firstValueFrom(
      this.couchdbService.delete(db, docId, queryParams),
    );
    await this.auditService.record(
      db,
      [
        {
          existingDoc: document,
          newDoc: { ...document, _deleted: true },
          newRev: result.rev,
          operation: 'delete',
        },
      ],
      user,
    );
    return result;
  }

  /**
   * Selectively apply changed properties only if the user has permissions for
   * that specific property. Properties the user may not change are omitted (no
   * error). Caveat: for an update this mutates `oldDoc` in place.
   */
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
      const updatedFields = pick(newDoc, permittedFields);
      return Object.assign(oldDoc, updatedFields);
    } else {
      // Updating whole document
      return newDoc;
    }
  }
}
