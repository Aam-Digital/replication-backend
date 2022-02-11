import { Controller, Param, Post } from '@nestjs/common';
import { RulesService } from './rules.service';
import { Observable } from 'rxjs';
import { Permission } from './permission';

@Controller('rules')
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /**
   * Reload the rules object from the database to apply changed permissions.
   *
   * @param db name of database from which the rules should be fetched
   */
  @Post('/:db/reload')
  reloadRules(@Param('db') db: string): Observable<Permission> {
    return this.rulesService.loadRules(db);
  }
}
