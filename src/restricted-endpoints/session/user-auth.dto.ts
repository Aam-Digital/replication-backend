/**
 * Credentials sent as payload for login
 */
export class UserCredentials {
  name: string;
  password: string;
}

/**
 * IAM account data as retrieved from the identity provider (e.g. Keycloak).
 * Does not include application-level data like projects.
 */
export class UserAccount {
  /**
   * @param id The account id (Keycloak user id)
   * @param name The entityId of the user profile (e.g. User:123 -> CouchDB)
   * @param roles The realm roles assigned to the account
   */
  constructor(
    public id: string,
    public name: string,
    public roles: string[],
  ) {}
}

/**
 * Internal user context used across authorization and permission checks.
 * It is assembled from authentication claims and profile data.
 */
export class UserInfo {
  /**
   * @param id The account id (Keycloak user id)
   * @param name The entityId of the user profile (e.g. User:123 -> CouchDB)
   * @param roles The roles the user has (via the Keycloak user)
   * @param projects The projects the user is linked to (via the user profile entity)
   */
  constructor(
    public id: string,
    public name: string,
    public roles: string[],
    public projects: string[] = [],
  ) {}
}

/**
 * Response payload sent by CouchDB at /_session
 */
export class SessionResponse {
  ok: boolean;
  userCtx: UserInfo;
}

export const COUCHDB_USER_DOC = 'org.couchdb.user';
