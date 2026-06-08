/**
 * Configuration and naming conventions for the audit / changelog feature.
 *
 * The audit module records every entity write to a separate CouchDB database
 * so that "what changed, by whom and when" can be reconstructed for legal/audit
 * purposes (see issue #4026 / #490).
 */
export class AuditConfig {
  /**
   * Feature flag (default off). When disabled the audit module is a no-op and
   * there is no behavior change on any write path.
   */
  static readonly AUDIT_ENABLED_ENV = 'AUDIT_ENABLED';

  /**
   * Fixed suffix appended to a source db name to derive its audit db name.
   * Hard-wired (not configurable) so per-db routing stays simple: writes to
   * `app` are audited in `app-audit`.
   */
  static readonly AUDIT_DB_SUFFIX = '-audit';
}

/**
 * Derive the audit db name for a given source db (e.g. `app` -> `app-audit`).
 */
export function auditDbFor(db: string): string {
  return `${db}${AuditConfig.AUDIT_DB_SUFFIX}`;
}

/**
 * Whether the given db name is an audit db (ends with the audit suffix).
 * Used to avoid recursively auditing the audit db itself.
 */
export function isAuditDb(db: string): boolean {
  return !!db && db.endsWith(AuditConfig.AUDIT_DB_SUFFIX);
}

/**
 * Only "real" entity documents are audited. CouchDB internal documents
 * (`_design/...` views, `_local/...` non-replicated docs) are skipped.
 *
 * (Equivalent to the `isReplicable` check referenced in the plan, which does
 * not exist as a shared service in this codebase version.)
 */
export function isReplicableId(id: string | undefined): boolean {
  return !!id && !id.startsWith('_design/') && !id.startsWith('_local/');
}
