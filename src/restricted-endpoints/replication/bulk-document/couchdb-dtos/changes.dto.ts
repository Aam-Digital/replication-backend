import { DatabaseDocument } from './bulk-docs.dto';

/**
 * DTOs for the /_changes endpoint of CouchDB used in the replication process.
 * These are not exact representations of the CouchDB API but are adapted to fit the needs of our application,
 * especially regarding permission handling.
 *
 * see https://docs.couchdb.org/en/stable/api/database/changes.html
 */
export interface ChangesResponse {
  last_seq: string;
  results: ChangeResult[];
  pending: number;

  /**
   * List of document IDs that were part of the changes feed but were not
   * included in the results due to lost permissions.
   *
   * This is a custom extension to the standard CouchDB _changes response.
   * PouchDB ignores this extra field, but the client's fetch wrapper reads it
   * to purge the corresponding local documents after sync.
   *
   * Only IDs are sent — the client looks up the local revision before purging,
   * because the server-side revision may not match the locally stored one.
   */
  lostPermissions?: string[];
}

export interface ChangeResult {
  doc?: DatabaseDocument;
  changes: { rev: string }[];
  deleted?: boolean;
  id: string;
  seq: string;
}

export interface ChangesParams {
  limit?: number;
  since?: string;
  include_docs?: string;
  [key: string]: any;
}
