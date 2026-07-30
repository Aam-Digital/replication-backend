import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { DocumentRule } from './rules.service';

/** Realm role granting full access. */
export const ADMIN_APP_ROLE = 'admin_app';

/**
 * Section keys in {@link RulesConfig} that carry special semantics instead of
 * mapping a user role. The underscore prefix marks them as internal so they
 * cannot collide with a realm role name. Legacy (non-prefixed) spellings are
 * still read for backward compatibility until all documents are migrated.
 */
export const DEFAULT_SECTION_KEY = '_default';
export const PUBLIC_SECTION_KEY = '_public';
/** @deprecated use {@link DEFAULT_SECTION_KEY}; only read for migration */
export const LEGACY_DEFAULT_KEY = 'default';
/** @deprecated use {@link PUBLIC_SECTION_KEY}; only read for migration */
export const LEGACY_PUBLIC_KEY = 'public';

/**
 * Legacy section key -> current section key. A config that still uses a legacy
 * key is normalized onto the current one when it is loaded, so only migration
 * code needs to know about the old spellings.
 *
 * @deprecated remove together with the legacy keys in the next major version
 */
export const LEGACY_SECTION_KEYS: Record<string, string> = {
  [LEGACY_DEFAULT_KEY]: DEFAULT_SECTION_KEY,
  [LEGACY_PUBLIC_KEY]: PUBLIC_SECTION_KEY,
};

/** A user role starting with this prefix is reserved and never resolved. */
export const RESERVED_ROLE_PREFIX = '_';

/**
 * All section keys (current and legacy) that must never be resolved as if they
 * were user role names, even if a realm role with the same name exists.
 */
export const RESERVED_RULE_CONFIG_KEYS: string[] = [
  DEFAULT_SECTION_KEY,
  PUBLIC_SECTION_KEY,
  ...Object.keys(LEGACY_SECTION_KEYS),
];

/**
 * The format of the JSON object which defines the rules for each role.
 * The format is `<user-role>: <array of DocumentRule>`, meaning for each role an array of rules can be defined.
 * The rules defined in '_default' (legacy 'default') are prepended to any other rules defined for a user.
 * The rules defined in '_public' (legacy 'public') are used if a user is not logged in.
 */
export type RulesConfig = {
  _public?: DocumentRule[];
  _default?: DocumentRule[];
  /** @deprecated use {@link RulesConfig._public} */
  public?: DocumentRule[];
  /** @deprecated use {@link RulesConfig._default} */
  default?: DocumentRule[];
  [key: string]: DocumentRule[] | undefined;
};

/**
 * The document stored in the database that defines all rules for the application.
 */
export class Permission extends DatabaseDocument {
  static DOC_ID = 'Config:Permissions';

  // This holds the rules definitions for each role
  data: RulesConfig;

  constructor(rules: RulesConfig) {
    super();
    this._id = Permission.DOC_ID;
    this.data = rules;
  }
}
