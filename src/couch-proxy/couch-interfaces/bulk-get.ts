import { DocError, DatabaseDocument } from './bulk-docs';

export interface BulkGetRequest {
  docs: { id: string; rev?: string }[];
}

export interface BulkGetResponse {
  results: {
    id: string;
    docs: ({ ok: DatabaseDocument } | { error: DocError })[];
  }[];
}
