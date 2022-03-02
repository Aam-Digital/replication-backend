import { DatabaseDocument } from '../../restricted-endpoints/replication/replication-endpoints/couchdb-dtos/bulk-docs.dto';
import { DocumentRule } from './rules.service';

export type RulesConfig = { [key in string]: DocumentRule[] };

/**
 * The document stored in the database that defines all rules for the application.
 */
export class Permission extends DatabaseDocument {
  static DOC_ID = 'Config:Permissions';
  data: RulesConfig;

  constructor(rules: RulesConfig) {
    super();
    this._id = Permission.DOC_ID;
    this.data = rules;
  }
}
