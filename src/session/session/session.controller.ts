import {
  Controller,
  Post,
  Req,
  UseGuards,
  Response,
  Delete,
} from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { TOKEN_KEY } from '../cookie/cookie.service';

@Controller()
export class SessionController {
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post('/_session')
  login(@Req() request: Request): User {
    return request.user as any;
  }

  /**
   * Logout endpoint. This only tells the browser to set a invalid cookie.
   * It does not un-validate existing cookies.
   * @param response
   */
  @Delete('/_session')
  logout(@Response() response) {
    response.cookie(TOKEN_KEY, '', { httpOnly: true });
    response.send({ ok: true });
  }
}
