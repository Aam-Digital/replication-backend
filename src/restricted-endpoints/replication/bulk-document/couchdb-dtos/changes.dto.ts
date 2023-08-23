import { DatabaseDocument } from './bulk-docs.dto';

export interface ChangesResponse {
  last_seq: string;
  results: ChangeResult[];
  pending: number;
}

export interface ChangeResult {
  doc?: DatabaseDocument;
  changes: { rev: string }[];
  id: string;
  seq: string;
}

export interface ChangesParams {
  limit?: number;
  since?: string;
  include_docs?: string;
  [key: string]: any;
}
