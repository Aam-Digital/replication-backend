import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { omit } from 'lodash';
import { firstValueFrom, map } from 'rxjs';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { UserInfo } from '../../session/user-auth.dto';
import {
  ChangeResult,
  ChangesParams,
  ChangesResponse,
} from '../bulk-document/couchdb-dtos/changes.dto';
import { DocumentFilterService } from '../document-filter/document-filter.service';

/**
 * Multiplier applied to the client-requested limit when fetching from CouchDB.
 * Since permission filtering removes a fraction of results, fetching more per
 * CouchDB round-trip reduces the number of iterations needed to fill the
 * client's requested limit.
 */
const INTERNAL_LIMIT_MULTIPLIER = 5;

/**
 * Maximum time (ms) to spend iterating through CouchDB changes before
 * returning a partial response. Browsers (Chrome in particular) abort idle
 * HTTP connections after ~10 s with ERR_NETWORK_CHANGED, so we must respond
 * well within that window. The client (PouchDB) will follow up with another
 * `_changes` request using the returned `last_seq`.
 */
const MAX_PROCESSING_TIME_MS = 8000;

/**
 * Hard upper cap on the number of changes requested from CouchDB in a single
 * round-trip. Protects the backend from very large client-supplied limits.
 */
const MAX_INTERNAL_LIMIT = 1000;

/** Internal extension of ChangesResponse with logging metadata. */
interface InternalChangesResponse extends ChangesResponse {
  _totalFetchedFromCouch?: number;
}

@UseGuards(CombinedAuthGuard)
@Controller()
export class ChangesController {
  private readonly logger = new Logger(ChangesController.name);

  constructor(
    private couchdbService: CouchdbService,
    private permissionService: PermissionService,
    private documentFilter: DocumentFilterService,
  ) {}

  /**
   * Get the changes stream.
   * The changes feed only returns the doc IDs to which the requesting user has access.
   * Even if `include_docs: true` is set, the stream will not return the document content.
   * @param db
   * @param params
   * @param user
   */
  @Get(':db/_changes')
  async changes(
    @Param('db') db: string,
    @User() user: UserInfo,
    @Query() params?: ChangesParams,
  ): Promise<ChangesResponse> {
    const startTime = Date.now();
    const ability = this.permissionService.getAbilityFor(user);
    const change: ChangesResponse = {
      results: [],
      lostPermissions: [],
      last_seq: '',
      pending: 0,
    };
    let since = params?.since;
    let iterations = 0;
    let totalFetched = 0;
    while (true) {
      iterations++;
      const remainingChangesUntilLimit =
        (params?.limit ?? Infinity) - change.results.length;
      const res = await this.getPermittedChanges(
        db,
        { ...params, since },
        ability,
        remainingChangesUntilLimit,
      );
      totalFetched += res._totalFetchedFromCouch ?? 0;
      change.results.push(...res.results);
      if (change.lostPermissions) {
        change.lostPermissions.push(...(res.lostPermissions ?? []));
      }
      change.last_seq = res.last_seq;
      change.pending = res.pending;
      const elapsed = Date.now() - startTime;
      if (
        change.pending === 0 ||
        (params?.limit !== undefined &&
          change.results.length >= params.limit) ||
        elapsed >= MAX_PROCESSING_TIME_MS
      ) {
        // enough changes found, none left, or time budget exhausted
        break;
      }
      since = res.last_seq;
    }
    if (params?.include_docs !== 'true') {
      // remove doc content if not requested
      change.results = change.results.map((c) => omit(c, 'doc'));
    }

    const duration = Date.now() - startTime;
    if (duration > 2000 || iterations > 2) {
      this.logger.warn(
        `_changes for "${db}" user="${user.name}" took ${duration}ms ` +
          `(${iterations} iterations, ${totalFetched} fetched from CouchDB, ` +
          `${change.results.length} permitted, ${change.lostPermissions?.length ?? 0} lost, ` +
          `since=${params?.since ?? 'undefined'}, limit=${params?.limit ?? 'none'}, pending=${change.pending})`,
      );
    } else {
      this.logger.debug(
        `_changes for "${db}" user="${user.name}": ${duration}ms, ` +
          `${iterations} iterations, ${change.results.length} results`,
      );
    }

    return change;
  }

  getPermittedChanges(
    db: string,
    params: ChangesParams,
    ability: DocumentAbility,
    limit: number = Infinity,
  ): Promise<InternalChangesResponse> {
    // Fetch more from CouchDB than needed, since permission filtering will
    // discard a portion of results. Base the multiplier on the *remaining*
    // limit (which shrinks each iteration) rather than the original client
    // limit, and apply a hard cap to protect against very large requests.
    const internalLimit = Math.min(
      limit * INTERNAL_LIMIT_MULTIPLIER,
      MAX_INTERNAL_LIMIT,
    );

    return firstValueFrom(
      this.couchdbService
        .get<ChangesResponse>(db, '_changes', {
          ...params,
          limit: internalLimit,
          include_docs: true,
        })
        .pipe(
          map((res) => {
            const totalFetched = res.results?.length ?? 0;
            const filtered: InternalChangesResponse = this.filterChanges(
              res,
              ability,
              limit,
            );
            // Attach metadata for logging (not sent to client — stripped by JSON serialization)
            filtered._totalFetchedFromCouch = totalFetched;
            return filtered;
          }),
        ),
    );
  }

  private filterChanges(
    changes: ChangesResponse,
    ability: DocumentAbility,
    limit: number = Infinity,
  ): ChangesResponse {
    const permitted: ChangeResult[] = [];
    const lostPermissions: string[] = [];
    let lastProcessedSeq = changes.last_seq;
    let unprocessedCount = 0;

    for (let i = 0; i < changes.results.length; i++) {
      const change = changes.results[i];

      if (!this.documentFilter.isReplicable(change.id)) {
        lastProcessedSeq = change.seq;
        continue;
      }

      const { doc } = change;

      const isPermitted = !doc
        ? change.deleted // tombstone with null doc
        : (doc._deleted && Object.keys(doc).length === 3) ||
          ability.can('read', doc);

      if (isPermitted) {
        if (permitted.length >= limit) {
          // This permitted result exceeds the limit - stop here
          unprocessedCount = changes.results.length - i;
          break;
        }
        permitted.push(change);
      } else if (doc) {
        // doc exists but user has no read permission - client should purge any local copy
        // TODO: could be limited to only include docs that may have been accessible before (e.g. only if entity type has a `conditions` rule in permissions)
        lostPermissions.push(change.id);
      }

      lastProcessedSeq = change.seq;
    }

    return {
      ...changes,
      results: permitted,
      lostPermissions,
      last_seq: unprocessedCount > 0 ? lastProcessedSeq : changes.last_seq,
      pending: changes.pending + unprocessedCount,
    };
  }
}
