import { Injectable } from '@nestjs/common';
import { User } from '../../session/session/user-auth.dto';
import { DatabaseDocument } from '../couch-proxy/couchdb-dtos/bulk-docs.dto';
import { RulesService } from '../rules/rules.service';

@Injectable()
export class PermissionService {
  constructor(private rulesService: RulesService) {}

  hasPermissionFor(document: DatabaseDocument, user: User): boolean {
    return true;
  }
}
