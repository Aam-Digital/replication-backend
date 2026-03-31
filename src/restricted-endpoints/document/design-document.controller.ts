import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../../auth/only-authenticated.decorator';
import { User } from '../../auth/user.decorator';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { PermissionService } from '../../permissions/permission/permission.service';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../session/user-auth.dto';

/**
 * Handle design document and view query endpoints that contain slashes
 * in their path (e.g. `_design/viewname` or `_design/viewname/_view/by_field`).
 *
 * These cannot be handled by the generic `/:db/:docId` route in {@link DocumentController}
 * because NestJS route parameters do not capture path segments containing slashes.
 */
@UseGuards(CombinedAuthGuard)
@Controller()
export class DesignDocumentController {
  constructor(
    private readonly couchdbService: CouchdbService,
    private readonly permissionService: PermissionService,
  ) {}

  /**
   * Fetch a design document from CouchDB.
   * @param db database name
   * @param designName design document name (without `_design/` prefix)
   * @param user logged in user
   * @param queryParams additional CouchDB query params
   */
  @OnlyAuthenticated()
  @Get(':db/_design/:designName')
  getDesignDoc(
    @Param('db') db: string,
    @Param('designName') designName: string,
    @User() user: UserInfo,
    @Query() queryParams?: any,
  ) {
    return this.couchdbService.get(db, `_design/${designName}`, queryParams);
  }

  /**
   * Create or update a design document in CouchDB.
   * Design documents define views/indexes and are functional metadata,
   * so any authenticated user is allowed to create/update them.
   * @param db database name
   * @param designName design document name (without `_design/` prefix)
   * @param document the design document body
   * @param user logged in user
   */
  @OnlyAuthenticated()
  @Put(':db/_design/:designName')
  async putDesignDoc(
    @Param('db') db: string,
    @Param('designName') designName: string,
    @Body() document: DatabaseDocument,
    @User() user: UserInfo,
  ): Promise<DocSuccess> {
    const ability = this.permissionService.getAbilityFor(user);
    if (!ability.can('manage', '_design')) {
      throw new ForbiddenException(
        'Missing permission to manage design documents',
      );
    }

    document._id = `_design/${designName}`;
    return firstValueFrom(this.couchdbService.put(db, document));
  }

  /**
   * Query a CouchDB view and filter the results based on user permissions.
   *
   * Proxies the request to CouchDB and filters out any documents
   * that the user is not permitted to read.
   *
   * @param db database name
   * @param designName design document name (without `_design/` prefix)
   * @param viewName the view to query
   * @param user logged in user
   * @param queryParams CouchDB view query parameters (key, startkey, endkey, include_docs, etc.)
   */
  @OnlyAuthenticated()
  @Get(':db/_design/:designName/_view/:viewName')
  async queryView(
    @Param('db') db: string,
    @Param('designName') designName: string,
    @Param('viewName') viewName: string,
    @User() user: UserInfo,
    @Query() queryParams?: any,
  ) {
    const viewPath = `_design/${designName}/_view/${viewName}`;
    const result = await firstValueFrom(
      this.couchdbService.get(db, viewPath, queryParams),
    );

    // Only filter rows if include_docs was requested (otherwise there's no doc to check)
    const includeDocs =
      queryParams?.include_docs === true || queryParams?.include_docs === 'true';
    if (includeDocs && result.rows) {
      const ability = this.permissionService.getAbilityFor(user);
      result.rows = result.rows.filter(
        (row) => {
          const isDeletedRow =
            row?.doc?._deleted === true ||
            row?.value?.deleted === true ||
            row?.deleted === true;

          if (isDeletedRow) {
            return true;
          }

          return !!row?.doc && ability.can('read', row.doc);
        },
      );
    }

    return result;
  }
}
