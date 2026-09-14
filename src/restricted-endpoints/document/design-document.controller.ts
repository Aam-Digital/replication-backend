import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { firstValueFrom } from 'rxjs';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { OnlyAuthenticated } from '../../auth/only-authenticated.decorator';
import { User } from '../../auth/user.decorator';
import { ClientDisconnectedError } from '../../common/client-disconnected.error';
import { JsonArrayResponseStream } from '../../common/json-array-response-stream';
import { CouchdbService } from '../../couchdb/couchdb.service';
import { PermissionService } from '../../permissions/permission/permission.service';
import {
  INTERNAL_LIMIT_MULTIPLIER,
  MAX_INTERNAL_LIMIT,
} from '../replication/changes/changes.controller';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { UserInfo } from '../session/user-auth.dto';
import {
  ViewQueryParams,
  ViewResponse,
  ViewResponseRow,
} from './couchdb-dtos/view.dto';

/**
 * Streams a paginated `_view` response to the client as JSON: permitted rows
 * are sent as soon as each internal CouchDB batch is filtered, instead of
 * accumulating everything in memory first.
 *
 * Field order differs from a plain CouchDB view response (`rows` before
 * `total_rows`/`offset` instead of after) because `offset` can only be
 * computed once every row has been examined; JSON object key order carries
 * no meaning for a client doing normal property access.
 */
class ViewResponseStream extends JsonArrayResponseStream {
  constructor(res: Response) {
    super(res, '{"rows":[');
  }

  /** Write one batch of permitted rows, opening the envelope if needed. */
  async writeRows(rows: ViewResponseRow[]): Promise<void> {
    await this.writeItems(rows, (row) => row);
  }

  /** Append `total_rows`/`offset` and end the response. */
  async finish(totalRows: number, offset: number): Promise<void> {
    await this.closeWith(`],"total_rows":${totalRows},"offset":${offset}}`);
  }
}

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
  private readonly logger = new Logger(DesignDocumentController.name);

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
    @Query() queryParams?: Record<string, string>,
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
   * When a valid `limit` is given together with `include_docs=true`, the backend
   * might request more docs than `limit` in order to find `limit` permitted docs.
   * To query further pages the frontend should then use the returned `offset`,
   * set `skip = offset + limit` and omit `startkey` in order to fetch the next
   * page of docs.
   *
   * @param db database name
   * @param designName design document name (without `_design/` prefix)
   * @param viewName the view to query
   * @param user logged in user
   * @param queryParams CouchDB view query parameters (key, startkey, endkey, include_docs, limit, skip, etc.)
   * @param res
   */
  @OnlyAuthenticated()
  @Get(':db/_design/:designName/_view/:viewName')
  async queryView(
    @Param('db') db: string,
    @Param('designName') designName: string,
    @Param('viewName') viewName: string,
    @User() user: UserInfo,
    @Query() queryParams: ViewQueryParams,
    @Res() res: Response,
  ): Promise<void> {
    const viewPath = `_design/${designName}/_view/${viewName}`;
    const includeDocs =
      queryParams.include_docs === 'true' || queryParams.include_docs === true;
    const limit = this.parseInt(queryParams.limit, 1);
    const rowFilter = this.viewRowFilter(user);

    if (!includeDocs || limit === undefined) {
      const result = await firstValueFrom(
        this.couchdbService.get<ViewResponse>(db, viewPath, queryParams),
      );
      if (includeDocs) {
        result.rows = result.rows.filter(rowFilter);
      }
      res.status(200).json(result);
      return;
    }

    const skip = this.parseInt(queryParams.skip) ?? 0;
    const stream = new ViewResponseStream(res);
    try {
      const { total_rows, offset } = await this.streamPermittedViewRows(
        db,
        viewPath,
        queryParams,
        skip,
        limit,
        rowFilter,
        stream,
      );
      await stream.finish(total_rows, offset);
    } catch (error) {
      // before the `headersSent` guard on purpose, see
      // {@link ChangesController.abortStreamOrRethrow}
      if (error instanceof ClientDisconnectedError) {
        this.logger.debug(
          'aborting streamed _view response: client disconnected',
        );
        res.destroy();
        return;
      }
      if (!res.headersSent) throw error;
      this.logger.warn('aborting streamed _view response after error', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.destroy();
    }
  }

  /**
   * Iteratively fetch from the view with an inflated internal `limit`,
   * filter by permission, and stream each permitted batch to the client.
   *
   * `offset` is defined so that pagination keeps working exactly like direct
   * CouchDB access once the client drops `startkey` and pages by absolute
   * position: it starts out as CouchDB's own `offset` for `skip` (identical
   * to talking to CouchDB directly when nothing gets filtered), and grows by
   * exactly the number of denied rows that had to be skipped over, so that
   * `offset + rows.length` always lands on the first not-yet-seen row.
   */
  private async streamPermittedViewRows(
    db: string,
    viewPath: string,
    queryParams: ViewQueryParams,
    skip: number,
    limit: number,
    isPermitted: (row: ViewResponseRow) => boolean,
    stream: ViewResponseStream,
  ): Promise<{ total_rows: number; offset: number }> {
    const baseParams: ViewQueryParams = { ...queryParams };
    delete baseParams.skip;
    delete baseParams.limit;

    let rawExamined = 0;
    let permittedCollected = 0;
    let total_rows = 0;
    let firstBatchOffset = skip;
    let firstBatch = true;

    while (permittedCollected < limit && !stream.isClosed) {
      const remaining = limit - permittedCollected;
      const internalLimit = Math.min(
        remaining * INTERNAL_LIMIT_MULTIPLIER,
        MAX_INTERNAL_LIMIT,
      );

      const response = await firstValueFrom(
        this.couchdbService.get<ViewResponse>(db, viewPath, {
          ...baseParams,
          skip: skip + rawExamined,
          limit: internalLimit,
        }),
      );

      if (firstBatch) {
        total_rows = response.total_rows ?? 0;
        firstBatchOffset = response.offset ?? skip;
        firstBatch = false;
      }

      const rows = response.rows;
      let permittedInBatch = 0;
      let cutoffIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        if (isPermitted(rows[i])) {
          permittedInBatch++;
          if (permittedCollected + permittedInBatch === limit) {
            cutoffIndex = i;
            break;
          }
        }
      }

      if (cutoffIndex >= 0) {
        // Enough permitted rows were found partway through this batch: stop
        // exactly here so `rawExamined` reflects only what was needed.
        await stream.writeRows(
          rows.slice(0, cutoffIndex + 1).filter(isPermitted),
        );
        rawExamined += cutoffIndex + 1;
        permittedCollected = limit;
        break;
      }

      await stream.writeRows(rows.filter(isPermitted));
      rawExamined += rows.length;
      permittedCollected += permittedInBatch;

      if (rows.length < internalLimit) break; // view exhausted
    }

    return {
      total_rows,
      offset: firstBatchOffset + rawExamined - permittedCollected,
    };
  }

  private viewRowFilter(user: UserInfo): (row: ViewResponseRow) => boolean {
    const ability = this.permissionService.getAbilityFor(user);
    return (row) => !!row?.doc && ability.can('read', row.doc);
  }

  private parseInt(value: unknown, min = 0): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min ? parsed : undefined;
  }
}
