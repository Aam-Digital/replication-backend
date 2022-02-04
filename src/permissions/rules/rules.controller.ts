import { Controller, Post } from '@nestjs/common';
import { RulesService } from './rules.service';
import { Observable } from 'rxjs';
import { Permission } from './permission';

@Controller('rules')
export class RulesController {
  constructor(private rulesService: RulesService) {}

  /**
   * Reload the rules object from the database to apply changed permissions.
   */
  @Post('reload')
  reloadRules(): Observable<Permission> {
    return this.rulesService.loadRules();
  }
}
