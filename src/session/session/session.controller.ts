import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { CouchAuthGuard } from '../auth/couch-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import { TOKEN_KEY } from '../jwt/jwt.strategy';
import { JwtService } from '@nestjs/jwt';

@Controller()
export class SessionController {
  constructor(private jwtService: JwtService) {}
  /**
   * Login endpoint.
   * Authenticates using the CouchAuthGuard.
   * @param request holding information about the current user
   * @param response which will be returned if no error is thrown
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(CouchAuthGuard)
  @Post('/_session')
  session(@Req() request, @Res() response: Response) {
    const user: User = request.user;
    const payload = { name: user.name, sub: user.roles };
    const jwtToken = this.jwtService.sign(payload);

    response
      .cookie(TOKEN_KEY, jwtToken, {
        domain: 'localhost',
        httpOnly: true,
        expires: new Date(Date.now() + 1000 * 60),
      })
      .send(user);
  }
}
