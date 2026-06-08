import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { omit } from 'lodash';
import * as jsondiffpatch from 'jsondiffpatch';
import { CouchdbService } from '../couchdb/couchdb.service';
import { UserInfo } from '../restricted-endpoints/session/user-auth.dto';
import {
  BulkDocsRequest,
  BulkDocsResponse,
  DatabaseDocument,
  DocError,
  DocSuccess,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import {
  AuditConfig,
  auditDbFor,
  isAuditDb,
  isReplicableId,
} from './audit.config';
import {
  AuditEntry,
  AuditRecordEntity,
  auditIdPrefix,
  auditUser,
  buildAuditId,
} from './audit-record.dto';

/**
 * Internal CouchDB noise excluded before diffing. The frontend-set `updated`
 * and `created` metadata (`{ at, by }`) are deliberately KEPT — they carry the
 * client's local edit time and claimed author, distinct information not
 * recoverable elsewhere.
 */
const IGNORED_DIFF_FIELDS = [
  '_rev',
  '_revisions',
  '_conflicts',
  '_attachments',
];

/**
 * Records every entity write to a separate, client-inaccessible `<db>-audit`
 * database. Gated behind the {@link AuditConfig.AUDIT_ENABLED_ENV}
 * flag; a complete no-op when disabled.
 *
 * Writes are best-effort-but-logged: a failed audit write never blocks
 * or fails the original entity write.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private readonly diffPatcher = jsondiffpatch.create({
    // identify array elements by their entity id so moves/edits diff sanely
    objectHash: (obj: any) => obj?._id ?? obj?.id ?? obj?.name,
    arrays: { detectMove: false },
  });

  /** audit dbs already known to exist, to avoid repeated create calls */
  private readonly ensuredDbs = new Set<string>();

  constructor(
    private readonly couchdbService: CouchdbService,
    private readonly configService: ConfigService,
  ) {}

  get enabled(): boolean {
    const value = this.configService.get(AuditConfig.AUDIT_ENABLED_ENV);
    return value === true || value === 'true';
  }

  /**
   * Record the given writes to the derived `<db>-audit` database.
   *
   * No-op when the feature is disabled or there is nothing replicable to audit.
   * The first change to a previously-unaudited entity additionally emits a
   * full-snapshot `baseline` record so history is not lost when the feature is
   * switched on for an existing system.
   *
   * @param db source database name (e.g. `app`)
   * @param entries the writes performed against `db`
   * @param user the authenticated user (server-trusted "who")
   */
  async record(
    db: string,
    entries: AuditEntry[],
    user: UserInfo,
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }
    if (isAuditDb(db)) {
      // never audit the audit db itself
      return;
    }

    const relevant = (entries ?? []).filter(
      (entry) => entry?.newDoc && isReplicableId(entry.newDoc._id),
    );
    if (relevant.length === 0) {
      return;
    }

    try {
      const auditDb = auditDbFor(db);
      await this.ensureDb(auditDb);

      // SERVER-set timestamp, never trusted from the client body
      const timestamp = new Date().toISOString();
      const records: AuditRecordEntity[] = [];

      for (const entry of relevant) {
        const entityId = entry.newDoc._id;
        if (!entityId) {
          // guaranteed by the isReplicableId filter above; narrows the type
          continue;
        }
        if (
          entry.existingDoc &&
          (await this.needsBaseline(auditDb, entityId, entry))
        ) {
          records.push(
            this.buildBaseline(
              db,
              entityId,
              entry.existingDoc,
              user,
              timestamp,
            ),
          );
        }
        records.push(this.buildRecord(db, entityId, entry, user, timestamp));
      }

      await firstValueFrom(
        this.couchdbService.post(auditDb, '_bulk_docs', { docs: records }),
      );
    } catch (err) {
      // best-effort: log but never fail the original write. Normalization must
      // itself never throw (JSON.stringify can throw on circular throwables).
      const reason = this.errorReason(err);
      this.logger.error(
        `Failed to write audit records for db '${db}': ${reason}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  /**
   * Record an audited bulk write: derive the audit entries from a `_bulk_docs`
   * response and persist them via {@link record}.
   *
   * `new_edits === false` (PouchDB push): CouchDB returns ONLY failed docs, so a
   * doc is successful when absent from the error list and its new `_rev` comes
   * from the submitted body. Otherwise the response carries `{ ok, rev }` per
   * doc and the rev comes from there. Conflicts/errors are skipped in both.
   *
   * @param written the (already permission-filtered) bulk request that was sent
   * @param existingDocs current revisions fetched before the write (diff "before")
   * @param response the CouchDB `_bulk_docs` response
   */
  async recordBulkWrite(
    db: string,
    written: BulkDocsRequest,
    existingDocs: Map<string, DatabaseDocument>,
    response: BulkDocsResponse,
    user: UserInfo,
  ): Promise<void> {
    return this.record(
      db,
      this.buildBulkEntries(written, existingDocs, response),
      user,
    );
  }

  private buildBulkEntries(
    written: BulkDocsRequest,
    existingDocs: Map<string, DatabaseDocument>,
    response: BulkDocsResponse,
  ): AuditEntry[] {
    const { errorIds, revById } = this.indexBulkResponse(response);
    const newEditsFalse = written.new_edits === false;
    return written.docs
      .map((doc) =>
        this.toAuditEntry(doc, existingDocs, errorIds, revById, newEditsFalse),
      )
      .filter((entry): entry is AuditEntry => entry !== null);
  }

  /** Index the `_bulk_docs` response into errored ids and successful revs. */
  private indexBulkResponse(response: BulkDocsResponse) {
    const errorIds = new Set<string>();
    const revById = new Map<string, string>();
    for (const result of response ?? []) {
      if ((result as DocError).error) {
        errorIds.add(result.id);
      } else {
        revById.set(result.id, (result as DocSuccess).rev);
      }
    }
    return { errorIds, revById };
  }

  /** Build a single audit entry, or null if the doc was not successfully written. */
  private toAuditEntry(
    doc: DatabaseDocument,
    existingDocs: Map<string, DatabaseDocument>,
    errorIds: Set<string>,
    revById: Map<string, string>,
    newEditsFalse: boolean,
  ): AuditEntry | null {
    const id = doc._id;
    if (!id) {
      return null;
    }
    const succeeded = newEditsFalse ? !errorIds.has(id) : revById.has(id);
    if (!succeeded) {
      return null;
    }
    const existingDoc = existingDocs.get(id);
    let operation: AuditEntry['operation'];
    if (doc._deleted) {
      operation = 'delete';
    } else if (existingDoc) {
      operation = 'update';
    } else {
      operation = 'create';
    }
    return {
      existingDoc,
      newDoc: doc,
      newRev: newEditsFalse ? doc._rev : revById.get(id),
      operation,
    };
  }

  /**
   * A baseline snapshot is needed when an existing entity is changed for the
   * first time after the feature was activated (no prior audit record).
   * Creates skip the baseline — the create record is itself the anchor.
   */
  private async needsBaseline(
    auditDb: string,
    entityId: string,
    entry: AuditEntry,
  ): Promise<boolean> {
    if (!entry.existingDoc || entry.operation === 'create') {
      return false;
    }
    return this.isFirstAuditFor(auditDb, entityId);
  }

  /**
   * Cheap range query: does any audit record already exist for this entity?
   */
  private async isFirstAuditFor(
    auditDb: string,
    entityId: string,
  ): Promise<boolean> {
    try {
      const prefix = auditIdPrefix(entityId);
      const response = await firstValueFrom(
        this.couchdbService.get<AllDocsResponse>(auditDb, '_all_docs', {
          startkey: JSON.stringify(`${prefix}:`),
          endkey: JSON.stringify(`${prefix}:￰`),
          limit: 1,
        }),
      );
      return (response.rows?.length ?? 0) === 0;
    } catch {
      // a lookup failure must not synthesize a spurious baseline; assume the
      // entity is already audited and skip the baseline
      return false;
    }
  }

  private buildBaseline(
    db: string,
    entityId: string,
    existingDoc: DatabaseDocument,
    user: UserInfo,
    timestamp: string,
  ): AuditRecordEntity {
    const rev = existingDoc._rev;
    return {
      _id: buildAuditId(entityId, timestamp, rev),
      entityId,
      database: db,
      operation: 'baseline',
      rev,
      parentRev: this.parentRevOf(existingDoc),
      timestamp,
      user: auditUser(user),
      // full snapshot, not a delta — there is nothing to diff against
      diff: this.clean(existingDoc),
    };
  }

  private buildRecord(
    db: string,
    entityId: string,
    entry: AuditEntry,
    user: UserInfo,
    timestamp: string,
  ): AuditRecordEntity {
    const rev = entry.newRev ?? entry.newDoc._rev;
    return {
      _id: buildAuditId(entityId, timestamp, rev),
      entityId,
      database: db,
      operation: entry.operation,
      rev,
      parentRev: this.parentRevOf(entry.newDoc),
      timestamp,
      user: auditUser(user),
      // winning-rev -> written-rev delta (see caveat in the plan)
      diff: this.diffPatcher.diff(
        this.clean(entry.existingDoc),
        this.clean(entry.newDoc),
      ),
    };
  }

  /**
   * Read the written rev's parent from the submitted doc's `_revisions`
   * ancestry (PouchDB pushes leaf revs with their ancestry).
   */
  private parentRevOf(doc: DatabaseDocument): string | undefined {
    const revisions = doc?._revisions;
    if (!revisions?.ids || revisions.ids.length < 2 || revisions.start < 1) {
      return undefined;
    }
    return `${revisions.start - 1}-${revisions.ids[1]}`;
  }

  /**
   * Strip internal CouchDB noise before diffing. Returns undefined unchanged
   * (so create diffs treat a missing "before" as empty).
   */
  private clean(
    doc: DatabaseDocument | undefined,
  ): DatabaseDocument | undefined {
    if (!doc) {
      return undefined;
    }
    return omit(doc, IGNORED_DIFF_FIELDS) as DatabaseDocument;
  }

  /** Non-throwing error-to-string for best-effort logging. */
  private errorReason(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  private async ensureDb(auditDb: string): Promise<void> {
    if (this.ensuredDbs.has(auditDb)) {
      return;
    }
    await firstValueFrom(this.couchdbService.createDb(auditDb));
    this.ensuredDbs.add(auditDb);
  }
}
