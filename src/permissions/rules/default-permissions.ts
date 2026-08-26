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
 * Baseline rules for unauthenticated visitors of a public form.
 *
 * `_public` is the `_default` equivalent for anonymous traffic: the `_default`
 * section is only merged for authenticated accounts (see
 * `RulesService.getRulesForUser`), so unauthenticated clients need their own
 * managed baseline.
 *
 * Unlike {@link MANAGED_DEFAULT_RULES} these are only written into a `_public`
 * section that an admin already uses (see {@link mergeManagedPublic}) - an
 * instance without public forms grants anonymous visitors nothing.
 */
export const MANAGED_PUBLIC_RULES: DocumentRule[] = [
  {
    // Config:Permissions is what makes the other rules enforceable: a client
    // that cannot read its own rule set has nothing to enforce and falls back
    // to allowing everything locally. CONFIG_ENTITY holds the entity/field
    // definitions a public form is rendered from.
    action: 'read',
    subject: 'Config',
    conditions: {
      _id: { $in: ['Config:CONFIG_ENTITY', 'Config:Permissions'] },
    },
    reason: `${SYSTEM_DEFAULT_MARKER} public form config read access`,
  },
  {
    // branding (logo, colors) of the page the form is displayed on
    action: 'read',
    subject: 'SiteSettings',
    reason: `${SYSTEM_DEFAULT_MARKER} public form site settings read access`,
  },
];

/** Outcome of merging a managed rule set into one section of the config. */
export interface ManagedRulesMerge {
  merged: DocumentRule[];
  changed: boolean;
  dropped: DocumentRule[];
  /** the section's admin-authored rules, i.e. everything not system-managed */
  adminRules: DocumentRule[];
}

/**
 * Merge a managed rule set into an existing rules section.
 * Managed rules are prepended and any previously written system-default rules
 * are replaced by the current managed set, so updated backend versions
 * refresh their own rules while admin-authored rules stay untouched.
 *
 * A non-array `currentSection` (e.g. `null` from a malformed document) is
 * treated the same as an empty section instead of throwing, so that a
 * malformed section gets actively healed rather than crashing the caller.
 */
function mergeManagedRules(
  currentSection: DocumentRule[] = [],
  managedRules: DocumentRule[] = MANAGED_DEFAULT_RULES,
): ManagedRulesMerge {
  const current = Array.isArray(currentSection) ? currentSection : [];
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
    (rule) => !managedRules.some((managed) => isEqual(managed, rule)),
  );
  const merged = [...managedRules, ...adminRules];
  return {
    merged,
    changed: !isEqual(merged, currentSection),
    dropped,
    adminRules,
  };
}

/** Merge {@link MANAGED_DEFAULT_RULES} into the `default` rules section. */
export function mergeManagedDefaults(
  currentDefault: DocumentRule[] = [],
): ManagedRulesMerge {
  return mergeManagedRules(currentDefault, MANAGED_DEFAULT_RULES);
}

/**
 * Merge {@link MANAGED_PUBLIC_RULES} into an existing `_public` rules section.
 *
 * Only sections that an admin actually uses are extended: the managed rules
 * are present exactly while the section holds at least one admin-authored
 * rule. So an instance that does not use public forms is never granted
 * anonymous read access, and an instance that stops using them has the managed
 * rules removed again on the next write-back.
 *
 * Returns `undefined` when the document has no `_public` section at all - the
 * section is never created here, only extended.
 */
export function mergeManagedPublic(
  currentPublic: DocumentRule[] | undefined,
): ManagedRulesMerge | undefined {
  if (currentPublic === undefined) {
    return undefined;
  }
  const result = mergeManagedRules(currentPublic, MANAGED_PUBLIC_RULES);
  if (result.adminRules.length > 0) {
    return result;
  }
  // section exists but is unused (empty, or only leftover managed rules):
  // strip the managed rules again instead of granting anonymous access
  return {
    ...result,
    merged: result.adminRules,
    changed: !isEqual(result.adminRules, currentPublic),
  };
}
