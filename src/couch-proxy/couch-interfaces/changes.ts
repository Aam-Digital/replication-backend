export interface ChangesFeed {
  last_seq: string;
  pending: number;
  results: ChangeDoc[];
}

export interface ChangeDoc {
  changes: { rev: string }[];
  id: string;
  seq: string;
  deleted?: boolean;
}
