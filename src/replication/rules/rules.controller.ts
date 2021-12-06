import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../session/jwt/jwt.guard';
import { RulesService } from './rules.service';

@UseGuards(JwtGuard)
@Controller('rules')
export class RulesController {
  constructor(private rulesService: RulesService) {}
  @Post('reload')
  /**
   * Reload the rules object from the database to apply changed permissions.
   */
  reloadRules() {
    this.rulesService.loadRules();
  }
}
