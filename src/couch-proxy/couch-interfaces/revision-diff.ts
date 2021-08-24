export interface RevisionDiffRequest {
  [key: string]: string[];
}

export interface RevisionDiffResponse {
  [key: string]: { missing: string[] };
}
