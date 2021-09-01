import { DatabaseDocument } from './bulk-docs';

export interface AllDocsRequest {
  keys: string[];
}

export interface AllDocsResponse {
  total_rows: number;
  offset: number;
  rows: {
    id: string;
    key: string;
    value: { rev: string };
    doc: DatabaseDocument;
  }[];
}
