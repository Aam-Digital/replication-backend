import { DatabaseDocument } from '../../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import { DocumentRule } from './rules.service';

/**
 * The format of the JSON object which defines the rules for each role.
 * The format is `<user-role>: <array of DocumentRule>`, meaning for each role an array of rules can be defined.
 * The rules defined in 'default' will be prepended to any other rules defined for a user
 * The rules defined in 'public' will be used if a user is not logged in
 */
export type RulesConfig = {
  public?: DocumentRule[];
  default?: DocumentRule[];
  [key: string]: DocumentRule[];
};

/**
 * The document stored in the database that defines all rules for the application.
 */
export class Permission extends DatabaseDocument {
  static DOC_ID = 'Config:Permissions';

  // This holds the rules definitions for each role
  data: RulesConfig;

  constructor(rules: RulesConfig) {
    super();
    this._id = Permission.DOC_ID;
    this.data = rules;
  }
}
