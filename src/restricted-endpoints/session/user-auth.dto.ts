/**
 * Credentials sent as payload for login
 */
export class UserCredentials {
  name: string;
  password: string;
}

/**
 * User object as used by CouchDB
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
