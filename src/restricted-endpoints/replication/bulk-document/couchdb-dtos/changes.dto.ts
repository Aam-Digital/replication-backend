import { DatabaseDocument } from './bulk-docs.dto';

export interface ChangesResponse {
  last_seq: string;
  results: ChangeResult[];
}

export interface ChangeResult {
  doc?: DatabaseDocument;
  changes: { rev: string }[];
  id: string;
  seq: string;
}
