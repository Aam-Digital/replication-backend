import { Controller, Get, UseGuards } from '@nestjs/common';
import { RawRule } from '@casl/ability';
import * as Rules from '../../assets/rules.json';
import { JwtGuard } from '../../session/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('rules')
export class RulesController {
  @Get('/')
  getRules(): { [key in string]: RawRule[] } {
    return Rules;
  }
}
