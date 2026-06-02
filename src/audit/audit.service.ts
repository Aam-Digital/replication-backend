import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { omit } from 'lodash';
import * as jsondiffpatch from 'jsondiffpatch';
import { CouchdbService } from '../couchdb/couchdb.service';
import { UserInfo } from '../restricted-endpoints/session/user-auth.dto';
import { DatabaseDocument } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { AllDocsResponse } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/all-docs.dto';
import {
  AuditConfig,
  auditDbFor,
  isAuditDb,
  isReplicableId,
} from './audit.config';
import {
  AuditEntry,
  AuditRecord,
  auditUser,
  buildAuditId,
} from './audit-record.dto';

/**
 * Internal CouchDB noise excluded before diffing. `_updatedAt`/`_updatedBy`
 * are deliberately KEPT — they carry the client's local edit time and claimed
 * author, distinct information not recoverable elsewhere.
 */
const IGNORED_DIFF_FIELDS = [
  '_rev',
  '_revisions',
  '_conflicts',
  '_attachments',
];

/**
 * Records every entity write to a separate, client-inaccessible `<db>-audit`
 * database (see issue #4026). Gated behind the {@link AuditConfig.AUDIT_ENABLED_ENV}
 * flag; a complete no-op when disabled.
 *
 * Writes are best-effort-but-logged for v1: a failed audit write never blocks
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
      const records: AuditRecord[] = [];

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
      // best-effort: log but never fail the original write
      this.logger.error(
        `Failed to write audit records for db '${db}': ${err}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
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
      const response = await firstValueFrom(
        this.couchdbService.get<AllDocsResponse>(auditDb, '_all_docs', {
          startkey: JSON.stringify(`${entityId}:`),
          endkey: JSON.stringify(`${entityId}:￰`),
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
  ): AuditRecord {
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
  ): AuditRecord {
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

  private async ensureDb(auditDb: string): Promise<void> {
    if (this.ensuredDbs.has(auditDb)) {
      return;
    }
    await firstValueFrom(this.couchdbService.createDb(auditDb));
    this.ensuredDbs.add(auditDb);
  }
}
