import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
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
    return this.feeds.get(db).asObservable();
  }

  private startFeed(db: string, subject: Subject<ChangeResult>): void {
    let lastSeq: string = 'now';

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
          this.logger.error(
            `Changes feed error for "${db}":`,
            err?.stack || String(err),
          );
          throw err;
        }),
        retry({ delay: 1000 }),
        repeat(),
      )
      .subscribe({
        next: (changes) => {
          lastSeq = changes.last_seq;
          for (const result of changes.results ?? []) {
            subject.next(result);
          }
        },
        error: (err) => {
          this.logger.error(
            `Changes feed for "${db}" terminated unexpectedly:`,
            err?.stack || String(err),
          );
        },
      });

    this.subscriptions.set(db, subscription);
  }
}
