export interface BulkDocsRequest {
  new_edits: boolean;
  docs: DatabaseDocument[];
}

export interface DatabaseDocument {
  _id: string;
  _rev: string;
  _deleted?: boolean;
  _revisions?: {
    start: number;
    ids: string[];
  };
  [key: string]: any;
}

export type BulkDocsResponse = (DocSuccess | DocError)[];

export interface DocSuccess {
  ok: boolean;
  id: string;
  rev: string;
}

export interface DocError {
  error: string;
  id: string;
  reason: string;
  rev: string;
}
