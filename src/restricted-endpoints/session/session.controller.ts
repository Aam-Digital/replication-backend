import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../../auth/guards/session-auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { Request } from 'express';

@Controller('/_session')
export class SessionController {
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post()
  login(@Req() request: Request): User {
    return request.user as any;
  }
}
