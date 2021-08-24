export interface BulkDocsRequest {
  new_edits: boolean;
  docs: DocWithRevisions[];
}

export interface DocWithRevisions {
  _id: string;
  _rev: string;
  _revisions: {
    ids: string[];
    start: number;
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
