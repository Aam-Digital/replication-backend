import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { Response } from 'express';
import { TOKEN_KEY } from '../jwt/jwt.strategy';

@Controller()
export class SessionController {
  constructor(private sessionService: SessionService) {}
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post('/_session')
  session(@Req() req, @Res() response: Response) {
    const user: User = req.user;
    const jwtToken = this.sessionService.login(user);
    response
      .cookie(TOKEN_KEY, jwtToken, {
        domain: 'localhost',
        httpOnly: true,
        expires: new Date(Date.now() + 1000 * 60),
      })
      .send(user);
  }
}
