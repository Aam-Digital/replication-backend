import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/guards/jwt/jwt.guard';
import { RulesService } from './rules.service';
import { Observable } from 'rxjs';
import { Permission } from './permission';

@UseGuards(JwtGuard)
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
