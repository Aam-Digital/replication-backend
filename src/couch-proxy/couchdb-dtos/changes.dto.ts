export class ChangesFeed {
  last_seq: string;
  pending: number;
  results: ChangeDoc[];
}

export class Change {
  rev: string;
}

export class ChangeDoc {
  changes: Change[];
  id: string;
  seq: string;
  deleted?: boolean;
}
