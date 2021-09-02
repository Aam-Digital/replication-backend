export class BulkDocsRequest {
  new_edits: boolean;
  docs: DatabaseDocument[];
}

export class DatabaseDocument {
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

export class DocSuccess {
  ok: boolean;
  id: string;
  rev: string;
}

export class DocError {
  error: string;
  id: string;
  reason: string;
  rev: string;
}
