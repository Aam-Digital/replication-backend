export interface BaseJwtPayload {
  sub: string;
}

export interface CookieJwtPayload extends BaseJwtPayload {
  name: string;
  roles: string[];
}

export interface BearerJwtPayload extends BaseJwtPayload {
  username: string;
  '_couchdb.roles': string[];
}
