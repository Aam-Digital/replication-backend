import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { DocumentRule } from './rules.service';

export class Permission extends DatabaseDocument {
  static DOC_ID = 'Permission:PERMISSION_ENTITY';
  rulesConfig: { [key in string]: DocumentRule[] };
  constructor(rules: { [key in string]: DocumentRule[] }) {
    super();
    this.rulesConfig = rules;
  }
}
