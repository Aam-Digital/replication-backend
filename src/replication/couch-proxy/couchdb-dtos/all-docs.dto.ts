import { DatabaseDocument } from './bulk-docs.dto';

export class AllDocsRequest {
  keys: string[];
}

class DocMetaInf {
  id: string;
  key: string;
  value: { rev: string };
  doc?: DatabaseDocument;
}

export class AllDocsResponse {
  total_rows: number;
  offset: number;
  rows: DocMetaInf[];
}
