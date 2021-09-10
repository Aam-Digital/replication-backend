export class RevisionDiffRequest {
  [key: string]: string[];
}

export class RevisionDiffResponse {
  [key: string]: { missing: string[] };
}
