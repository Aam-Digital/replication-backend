import { DocError, DocWithRevisions } from './bulk-docs';

export interface BulkGetRequest {
  docs: { id: string; rev?: string }[];
}

export interface BulkGetResponse {
  results: {
    id: string;
    docs: (DocWithRevisions | ErrorDocResponse)[];
  }[];
}

export interface ErrorDocResponse {
  error: DocError;
}
