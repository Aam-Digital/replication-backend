import { DatabaseDocument } from '../../replication/bulk-document/couchdb-dtos/bulk-docs.dto';

/**
 * DTOs for CouchDB's `_design/<ddoc>/_view/<view>` endpoint.
 * This is a subset of what is supported by CouchDB.
 * Support on params not mentioned here might not be given.
 *
 * see https://docs.couchdb.org/en/stable/api/ddoc/views.html
 */

/**
 * Query parameters accepted on a view request. Values arrive as raw
 * query-string strings (Express does not parse them) and are forwarded to
 * CouchDB as-is, so they keep CouchDB's own JSON-encoded-string wire format
 * (e.g. `startkey=%22foo%22`) rather than being decoded here.
 *
 * Only the fields this backend actually inspects (`include_docs`, `limit`,
 * `skip`) are typed explicitly; everything else CouchDB accepts (`key`,
 * `startkey`, `endkey`, `descending`, `group`, ...) passes through untouched
 * via the index signature.
 */
export interface ViewQueryParams {
  include_docs?: string | boolean;
  limit?: string;
  skip?: string;
  [key: string]: unknown;
}

export interface ViewResponseRow {
  id: string;
  key?: unknown;
  value?: Record<string, unknown>;
  doc?: DatabaseDocument;
  deleted?: boolean;
}

export interface ViewResponse {
  total_rows?: number;
  offset?: number;
  rows: ViewResponseRow[];
  [key: string]: unknown;
}
