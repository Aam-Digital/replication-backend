import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { DocumentRule } from './rules.service';

export class Permissions extends DatabaseDocument {
  rulesConfig: DocumentRule[];
}
