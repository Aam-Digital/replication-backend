export class UserCredentials {
  name: string;
  password: string;
}

export class User {
  constructor(public name: string, public roles: string[]) {}
}

export class SessionResponse {
  userCtx: User;
}

export const COUCHDB_USER_DOC = 'org.couchdb.user';
