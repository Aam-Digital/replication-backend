import { Injectable } from '@nestjs/common';
import { BulkGetResponse } from '../couch-proxy/couch-interfaces/bulk-get';
import { AccessControlEntry } from './access-control-entry';
import { AllDocsResponse } from '../couch-proxy/couch-interfaces/all-docs';

@Injectable()
export class DocumentFilterService {
  public accessControlList: AccessControlEntry[];

  filterBulkGetDocuments(
    response: BulkGetResponse,
    userRoles: string[],
  ): BulkGetResponse {
    response.results = response.results.filter((doc) => {
      const matchingAccessControlEntries = this.accessControlList.filter(
        (entry) => doc.id.toLowerCase().startsWith(entry.entity.toLowerCase()),
      );
      if (matchingAccessControlEntries.length > 0) {
        return matchingAccessControlEntries.some((entry) =>
          entry.roles.some((role) => userRoles.includes(role)),
        );
      } else {
        // No permissions found
        return true;
      }
    });
    return response;
  }

  filterAllDocsDocuments(
    response: AllDocsResponse,
    userRoles: string[],
  ): AllDocsResponse {
    response.rows = response.rows.filter((doc) => {
      const matchingAccessControlEntries = this.accessControlList.filter(
        (entry) => doc.id.toLowerCase().startsWith(entry.entity.toLowerCase()),
      );
      if (matchingAccessControlEntries.length > 0) {
        return matchingAccessControlEntries.some((entry) =>
          entry.roles.some((role) => userRoles.includes(role)),
        );
      } else {
        // No permissions found
        return true;
      }
    });
    return response;
  }
}
