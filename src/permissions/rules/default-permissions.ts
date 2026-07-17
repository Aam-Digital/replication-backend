import { isEqual } from 'lodash';
import type { DocumentRule } from './rules.service';

/**
 * Marker in a rule's `reason` field identifying rules that are managed by the
 * backend itself. The write-back recognises and refreshes these rules without
 * touching admin-authored rules.
 */
export const SYSTEM_DEFAULT_MARKER = '[system-default]';

/**
 * Essential baseline rules every authenticated user needs so that an instance
 * cannot lock itself out of core functionality. These are idempotently written
 * into the `default` section of the Config:Permissions document, prepended
 * (lowest CASL priority) so explicit admin rules can override them.
 *
 * During a rolling deploy, instances with a different managed set may rewrite
 * each other's rules until the deploy completes. This flip-flop is transient
 * and accepted; avoid long-running mixed-version deployments.
 */
export const MANAGED_DEFAULT_RULES: DocumentRule[] = [
  {
    // All Config docs share the CASL subject "Config" (the _id prefix), so
    // this rule must be scoped to specific _ids. Config backups such as
    // "Config:CONFIG_ENTITY:<timestamp>" deliberately stay restrictable.
    action: 'read',
    subject: 'Config',
    conditions: {
      _id: {
        $in: [
          'Config:CONFIG_ENTITY',
          'Config:Permissions',
          'Config:NotificationConfigTemplate',
        ],
      },
    },
    reason: `${SYSTEM_DEFAULT_MARKER} core config read access`,
  },
  {
    // edits are intentionally not granted here and stay denied by default
    action: 'read',
    subject: 'SiteSettings',
    reason: `${SYSTEM_DEFAULT_MARKER} site settings read access`,
  },
  {
    // NotificationConfig.userId holds the account id (Keycloak user id),
    // which matches ${user.id} in both frontend and backend interpolation
    action: 'manage',
    subject: 'NotificationConfig',
    conditions: { userId: '${user.id}' },
    reason: `${SYSTEM_DEFAULT_MARKER} manage own notification config`,
  },
  {
    // Ownership is enforced by the per-user notification databases, not by
    // this rule; this rule only enables the frontend UI actions.
    action: 'manage',
    subject: 'NotificationEvent',
    reason: `${SYSTEM_DEFAULT_MARKER} manage own notification events`,
  },
];

/**
 * Merge the managed default rules into an existing `default` rules section.
 * Managed rules are prepended and any previously written system-default rules
 * are replaced by the current managed set, so updated backend versions
 * refresh their own rules while admin-authored rules stay untouched.
 *
 * A non-array `currentDefault` (e.g. `null` from a malformed document) is
 * treated the same as an empty section instead of throwing, so that a
 * malformed `default` section gets actively healed rather than crashing the
 * caller.
 */
export function mergeManagedDefaults(currentDefault: DocumentRule[] = []): {
  merged: DocumentRule[];
  changed: boolean;
  dropped: DocumentRule[];
} {
  const current = Array.isArray(currentDefault) ? currentDefault : [];
  const adminRules = current.filter(
    (rule) =>
      typeof rule.reason !== 'string' ||
      !rule.reason.includes(SYSTEM_DEFAULT_MARKER),
  );
  const removedMarkerRules = current.filter(
    (rule) =>
      typeof rule.reason === 'string' &&
      rule.reason.includes(SYSTEM_DEFAULT_MARKER),
  );
  // Rules that carried the marker but do not match the current managed set:
  // either outdated (superseded by a newer managed rule) or an admin's
  // customized copy of a managed rule. Either way they are dropped here and
  // worth a warning so an admin notices a customization was overwritten.
  const dropped = removedMarkerRules.filter(
    (rule) => !MANAGED_DEFAULT_RULES.some((managed) => isEqual(managed, rule)),
  );
  const merged = [...MANAGED_DEFAULT_RULES, ...adminRules];
  return { merged, changed: !isEqual(merged, currentDefault), dropped };
}
