import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { Request } from 'express';

@Controller()
export class SessionController {
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post('/_session')
  session(@Req() request: Request) {
    return request.user;
  }
}
