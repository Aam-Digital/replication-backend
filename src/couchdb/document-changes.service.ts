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
    // Tracks consecutive auth failures so we can back off log spam and request rate.
    let consecutiveAuthFailures = 0;

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
          if (this.isAuthError(err)) {
            consecutiveAuthFailures += 1;
            // Log the actionable message loudly once, then once per ~minute, to avoid log flooding.
            if (
              consecutiveAuthFailures === 1 ||
              consecutiveAuthFailures % 60 === 0
            ) {
              this.logger.error(
                `CRITICAL: CouchDB rejected the configured credentials on the changes feed for "${db}" ` +
                  `(failure #${consecutiveAuthFailures}). Verify DATABASE_USER, DATABASE_PASSWORD and ` +
                  `DATABASE_URL — the service may be talking to the wrong CouchDB instance. ` +
                  `Last error: ${this.formatError(err)}`,
              );
            }
          } else {
            consecutiveAuthFailures = 0;
            this.logger.error(
              `Changes feed error for "${db}": ${this.formatError(err)}`,
            );
          }
          throw err;
        }),
        retry({
          // Back off aggressively when we keep hitting auth errors so we don't hammer
          // CouchDB or flood logs at 1Hz; recover immediately on transient errors.
          delay: (err) =>
            of(err).pipe(
              concatMap(() => {
                const isAuth = this.isAuthError(err);
                const delayMs = isAuth
                  ? Math.min(60_000, 1000 * 2 ** Math.min(consecutiveAuthFailures, 6))
                  : 1000;
                return timer(delayMs);
              }),
            ),
        }),
        repeat(),
      )
      .subscribe({
        next: (changes) => {
          consecutiveAuthFailures = 0;
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
}
