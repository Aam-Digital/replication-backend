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
export class User {
  constructor(public name: string, public roles: string[]) {}
}

/**
 * Response payload sent by CouchDB at /_session
 */
export class SessionResponse {
  userCtx: User;
}

export const COUCHDB_USER_DOC = 'org.couchdb.user';
