import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  catchError,
  concatMap,
  defer,
  Observable,
  of,
  repeat,
  retry,
  Subject,
  Subscription,
  timer,
} from 'rxjs';
import { ExponentialBackoff } from '../common/exponential-backoff';
import {
  ChangeResult,
  ChangesResponse,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/changes.dto';
import { CouchdbService } from './couchdb.service';

/**
 * Maintains a single CouchDB _changes longpoll feed per database
 * and multicasts individual change results to subscribers.
 */
@Injectable()
export class DocumentChangesService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentChangesService.name);
  private readonly feeds = new Map<string, Subject<ChangeResult>>();
  private readonly subscriptions = new Map<string, Subscription>();

  constructor(private readonly couchdbService: CouchdbService) {}

  private formatError(err: unknown): string {
    if (err instanceof HttpException) {
      const response = err.getResponse();
      const detail =
        typeof response === 'string' ? response : JSON.stringify(response);
      return `HttpException ${err.getStatus()}: ${detail}`;
    }
    return (err as Error)?.stack || String(err);
  }

  private isAuthError(err: unknown): boolean {
    return (
      err instanceof HttpException &&
      (err.getStatus() === 401 || err.getStatus() === 403)
    );
  }

  onModuleDestroy(): void {
    for (const [db, subscription] of this.subscriptions) {
      subscription.unsubscribe();
      this.feeds.get(db)?.complete();
    }
    this.subscriptions.clear();
    this.feeds.clear();
  }

  /**
   * Returns an Observable that emits each individual ChangeResult
   * from the _changes feed of the given database.
   *
   * The underlying longpoll connection is started on the first call
   * and shared across all callers for that database.
   */
  getChanges(db: string): Observable<ChangeResult> {
    if (!this.feeds.has(db)) {
      const subject = new Subject<ChangeResult>();
      this.feeds.set(db, subject);
      this.startFeed(db, subject);
    }
    return this.feeds.get(db)!.asObservable();
  }

  private startFeed(db: string, subject: Subject<ChangeResult>): void {
    let lastSeq: string = 'now';
    // Tracks consecutive failures so we can back off the request rate and
    // throttle log output until the feed recovers.
    const backoff = new ExponentialBackoff();

    const getParams = defer(() =>
      of({
        feed: 'longpoll',
        since: lastSeq,
        include_docs: true,
        timeout: 50000,
      }),
    );

    const subscription = getParams
      .pipe(
        concatMap((params) =>
          this.couchdbService.get<ChangesResponse>(db, '_changes', params),
        ),
        catchError((err) => {
          backoff.recordFailure();
          this.logFeedError(db, err, backoff);
          throw err;
        }),
        retry({
          // Back off exponentially so we do not hammer CouchDB or flood logs
          // at 1Hz when the feed is failing persistently.
          delay: () => timer(backoff.currentDelay),
        }),
        repeat(),
      )
      .subscribe({
        next: (changes) => {
          backoff.reset();
          lastSeq = changes.last_seq;
          for (const result of changes.results ?? []) {
            subject.next(result);
          }
        },
        error: (err) => {
          this.logger.error(
            `Changes feed for "${db}" terminated unexpectedly: ${this.formatError(err)}`,
          );
        },
      });

    this.subscriptions.set(db, subscription);
  }

  /**
   * Log feed errors with severity that escalates with the failure streak:
   * during the exponential ramp-up they are logged as warnings to avoid
   * spamming the error stream; once the backoff has saturated at its cap the
   * situation is treated as a sustained outage and logged as an error
   * (throttled to once per {@link DocumentChangesService.SATURATED_LOG_EVERY_N}
   * retries to keep the log volume manageable).
   */
  private logFeedError(
    db: string,
    err: unknown,
    backoff: ExponentialBackoff,
  ): void {
    const failureCount = backoff.failureCount;
    const isAuth = this.isAuthError(err);
    const baseMessage = isAuth
      ? `CouchDB rejected the configured credentials on the changes feed for "${db}" ` +
        `(failure #${failureCount}). Verify DATABASE_USER, DATABASE_PASSWORD and DATABASE_URL — ` +
        `the service may be talking to the wrong CouchDB instance. ` +
        `Last error: ${this.formatError(err)}`
      : `Changes feed error for "${db}" (failure #${failureCount}): ${this.formatError(err)}`;

    if (!backoff.isSaturated) {
      this.logger.warn(baseMessage);
      return;
    }

    if (
      backoff.justSaturated ||
      failureCount % DocumentChangesService.SATURATED_LOG_EVERY_N === 0
    ) {
      this.logger.error(`SUSTAINED OUTAGE: ${baseMessage}`);
    }
  }

  /**
   * Once the backoff has saturated, only log every Nth failure as an error to
   * avoid flooding the log stream during long-running outages.
   */
  static readonly SATURATED_LOG_EVERY_N = 30;
}
