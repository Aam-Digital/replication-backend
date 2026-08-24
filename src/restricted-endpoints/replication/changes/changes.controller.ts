import {
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { omit } from 'lodash';
import { JsonArrayResponseStream } from '../../../common/json-array-response-stream';
import { firstValueFrom, map } from 'rxjs';
import { CombinedAuthGuard } from '../../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../../auth/user.decorator';
import { CouchdbService } from '../../../couchdb/couchdb.service';
import {
  DocumentAbility,
  PermissionService,
} from '../../../permissions/permission/permission.service';
import { UserInfo } from '../../session/user-auth.dto';
import { DatabaseDocument } from '../bulk-document/couchdb-dtos/bulk-docs.dto';
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
export const INTERNAL_LIMIT_MULTIPLIER = 5;

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
export const MAX_INTERNAL_LIMIT = 1000;

/**
 * Requests taking longer than this are logged as a warning.
 *
 * Deliberately based on duration only: a high number of CouchDB round-trips is
 * normal for users whose permissions filter out most changes, and says nothing
 * about how long the request actually took. Those requests are still logged
 * (with their `iterations` count) on the debug level below.
 */
const SLOW_REQUEST_DURATION_MS = 2000;

/**
 * A "clean" deletion tombstone holds nothing but `_id`, `_rev` and `_deleted`.
 */
const CLEAN_TOMBSTONE_PROPERTY_COUNT = 3;

/** Internal extension of ChangesResponse with logging metadata. */
interface InternalChangesResponse extends ChangesResponse {
  _totalFetchedFromCouch?: number;
}

/** Outcome of iterating through the CouchDB changes of one request. */
interface ChangesSummary {
  lastSeq: string;
  pending: number;
  lostPermissions: string[];
  /** number of results written to the client */
  resultsWritten: number;
  /** number of CouchDB round-trips made */
  iterations: number;
  /** number of changes received from CouchDB, before permission filtering */
  totalFetched: number;
}

/** The accumulating state while the iteration is still running. */
type ChangesProgress = Omit<ChangesSummary, 'resultsWritten'>;

/**
 * Streams a {@link ChangesResponse} to the client as JSON: results are sent as
 * soon as each internal CouchDB batch is filtered, instead of accumulating
 * everything in memory first (#109). The envelope fields (last_seq, pending,
 * lostPermissions) are appended once the iteration finishes.
 */
class ChangesResponseStream extends JsonArrayResponseStream {
  constructor(
    res: Response,
    private readonly includeDocs: boolean,
  ) {
    super(res, '{"results":[');
  }

  /** Write one batch of permitted changes, opening the envelope if needed. */
  async writeResults(results: ChangeResult[]): Promise<void> {
    await this.writeItems(results, (result) =>
      this.includeDocs ? result : omit(result, 'doc'),
    );
  }

  /** Append the envelope fields and end the response. */
  async finish(
    lastSeq: string,
    pending: number,
    lostPermissions: string[],
  ): Promise<void> {
    await this.closeWith(
      `],"last_seq":${JSON.stringify(lastSeq)},"pending":${pending}` +
        `,"lostPermissions":${JSON.stringify(lostPermissions)}}`,
    );
  }
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
   *
   * @param db
   * @param user
   * @param params
   * @param res
   */
  @Get(':db/_changes')
  async changes(
    @Param('db') db: string,
    @User() user: UserInfo,
    @Query() params: ChangesParams | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const startTime = Date.now();
    const stream = new ChangesResponseStream(
      res,
      params?.include_docs === 'true',
    );

    try {
      const summary = await this.streamPermittedChanges(
        db,
        user,
        params,
        stream,
        startTime + MAX_PROCESSING_TIME_MS,
      );
      await stream.finish(
        summary.lastSeq,
        summary.pending,
        summary.lostPermissions,
      );
      this.logCompletedRequest(db, user, params, summary, startTime);
    } catch (error) {
      this.abortStreamOrRethrow(error, res);
    }
  }

  /**
   * Repeatedly fetch changes from CouchDB and write the permitted ones to the
   * stream, until the client's limit is filled, no changes are left or the
   * time budget is exhausted.
   */
  private async streamPermittedChanges(
    db: string,
    user: UserInfo,
    params: ChangesParams | undefined,
    stream: ChangesResponseStream,
    deadline: number,
  ): Promise<ChangesSummary> {
    const ability = this.permissionService.getAbilityFor(user);
    const progress: ChangesProgress = {
      lastSeq: '',
      pending: 0,
      lostPermissions: [],
      iterations: 0,
      totalFetched: 0,
    };
    let since = params?.since;

    do {
      const batch = await this.getPermittedChanges(
        db,
        { ...params, since },
        ability,
        (params?.limit ?? Infinity) - stream.docsWritten,
      );
      await stream.writeResults(batch.results);

      progress.iterations++;
      progress.totalFetched += batch._totalFetchedFromCouch ?? 0;
      progress.lostPermissions.push(...(batch.lostPermissions ?? []));
      progress.lastSeq = batch.last_seq;
      progress.pending = batch.pending;
      since = batch.last_seq;
    } while (
      !this.isIterationComplete(
        progress.pending,
        params?.limit,
        deadline,
        stream,
      )
    );

    return { ...progress, resultsWritten: stream.docsWritten };
  }

  /**
   * Whether to stop requesting further batches, because no changes are left,
   * enough were found, the time budget is exhausted or the client disconnected.
   */
  private isIterationComplete(
    pending: number,
    limit: number | undefined,
    deadline: number,
    stream: ChangesResponseStream,
  ): boolean {
    const noChangesLeft = pending === 0;
    const enoughFound = limit !== undefined && stream.docsWritten >= limit;
    const outOfTime = Date.now() >= deadline;
    return noChangesLeft || enoughFound || outOfTime || stream.isClosed;
  }

  /**
   * Recover from an error raised while streaming:
   * if nothing has been sent yet, let the regular exception handling reply.
   * Otherwise abort the connection, so that the client sees a truncated
   * response (and retries) instead of valid-looking JSON.
   */
  private abortStreamOrRethrow(error: unknown, res: Response): void {
    if (!res.headersSent) {
      throw error;
    }
    this.logger.warn('aborting streamed _changes response after error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.destroy();
  }

  private logCompletedRequest(
    db: string,
    user: UserInfo,
    params: ChangesParams | undefined,
    summary: ChangesSummary,
    startTime: number,
  ): void {
    const duration = Date.now() - startTime;
    const details = {
      db,
      user: user?.name ?? 'anonymous',
      duration,
      iterations: summary.iterations,
      fetched: summary.totalFetched,
      permitted: summary.resultsWritten,
      lost: summary.lostPermissions.length,
      since: params?.since ?? 'undefined',
      limit: params?.limit ?? 'none',
      pending: summary.pending,
    };
    if (duration > SLOW_REQUEST_DURATION_MS) {
      this.logger.warn('_changes request slow', details);
    } else {
      this.logger.debug('_changes request completed', details);
    }
  }

  private getPermittedChanges(
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

      if (this.isPermitted(change, ability)) {
        if (permitted.length >= limit) {
          // This permitted result exceeds the limit - stop here
          unprocessedCount = changes.results.length - i;
          break;
        }
        permitted.push(change);
      } else if (change.doc) {
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

  private isPermitted(change: ChangeResult, ability: DocumentAbility): boolean {
    if (!change.doc) {
      return !!change.deleted; // tombstone with null doc
    }
    // clean tombstones carry no data, so they can be forwarded to anyone,
    // letting PouchDB delete the doc locally
    return this.isCleanTombstone(change.doc) || ability.can('read', change.doc);
  }

  private isCleanTombstone(doc: DatabaseDocument): boolean {
    return (
      !!doc._deleted &&
      Object.keys(doc).length === CLEAN_TOMBSTONE_PROPERTY_COUNT
    );
  }
}
