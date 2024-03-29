export class BulkDocsRequest {
  new_edits: boolean;
  docs: DatabaseDocument[];
}

export class FindResponse {
  docs: DatabaseDocument[];
  bookmark: string;
  warning?: string;
}

export class DatabaseDocument {
  // This can be optional when a single document is put into the database
  _id?: string;
  // This can be optional when a document is created
  _rev?: string;
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
