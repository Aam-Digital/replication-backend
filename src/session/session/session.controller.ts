import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';

@Controller()
export class SessionController {
  constructor() {}
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   * @param req
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post('/_session')
  session(@Req() req): User {
    return req.user;
  }
}
