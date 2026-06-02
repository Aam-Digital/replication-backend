import { UserInfo } from '../restricted-endpoints/session/user-auth.dto';
import { DatabaseDocument } from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';

/**
 * The kind of write that produced an audit record.
 *
 * `baseline` is a full-snapshot anchor written for an entity that has no prior
 * audit record yet, so the feature can be switched on for an existing system
 * without losing the starting point (see {@link AuditService}).
 */
export type AuditOperation = 'create' | 'update' | 'delete' | 'baseline';

/**
 * One audited write, as passed by a write path to {@link AuditService.record}.
 */
export interface AuditEntry {
  /**
   * The current winning revision fetched from CouchDB before the write
   * (the "before" side of the diff), or undefined when creating.
   *
   * MUST be a deep clone captured before any in-place mutation of the doc
   * (e.g. the PUT path's `applyPermissions` mutates the existing doc).
   */
  existingDoc?: DatabaseDocument;

  /**
   * The document as written (the "after" side of the diff). For a delete this
   * is the existing doc marked `_deleted`.
   */
  newDoc: DatabaseDocument;

  /**
   * The new `_rev` of the written revision. On the bulk `new_edits:false` path
   * this comes from the submitted doc body; otherwise from the CouchDB response.
   */
  newRev?: string;

  operation: AuditOperation;
}

/**
 * The persisted audit document, stored in the derived `<db>-audit` database.
 *
 * `_id` encodes the entity id and timestamp for performant per-entity range
 * queries: `<entityId>:<ISO-timestamp>:<new-rev>`.
 */
export interface AuditRecord {
  _id: string;
  /** the changed doc's `_id`, e.g. `Child:123` */
  entityId: string;
  /** source db name, e.g. `app` */
  database: string;
  operation: AuditOperation;
  /** new `_rev` of the written revision */
  rev?: string;
  /** the written rev's parent, from the submitted doc's `_revisions` ancestry */
  parentRev?: string;
  /** SERVER-set time (never trusted from the client body) */
  timestamp: string;
  /** SERVER-set from the authenticated UserInfo (never trusted from the body) */
  user: { id: string; name: string; roles: string[] };
  /**
   * For create/update/delete: a jsondiffpatch delta (winning-rev -> written-rev).
   * For baseline: the full previous document (there is nothing to diff against).
   */
  diff?: any;
}

/**
 * Build the deterministic audit record `_id`.
 */
export function buildAuditId(
  entityId: string,
  timestamp: string,
  rev: string | undefined,
): string {
  // full rev (not shortened) so records in a single same-timestamp batch
  // never collide on `_id`
  return `${entityId}:${timestamp}:${rev ?? 'na'}`;
}

/**
 * Map an authenticated {@link UserInfo} to the trimmed shape stored on records.
 */
export function auditUser(user: UserInfo): AuditRecord['user'] {
  return { id: user?.id, name: user?.name, roles: user?.roles ?? [] };
}
