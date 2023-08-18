import { DatabaseDocument } from './bulk-docs.dto';

export interface ChangesResponse {
  last_seq: string;
  results: { doc: DatabaseDocument }[];
}
