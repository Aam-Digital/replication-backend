import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Response,
  UseGuards,
} from '@nestjs/common';
import { User, UserCredentials } from './user-auth.dto';
import { BodyAuthGuard } from '../../auth/guards/body-auth/body-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import { TOKEN_KEY } from '../../auth/cookie/cookie.service';
import { CombinedAuthMiddleware } from '../../auth/guards/combined-auth.middleware';

@Controller('/_session')
export class SessionController {
  constructor(private combinedAuth: CombinedAuthMiddleware) {}

  /**
   * Login endpoint.
   * Authenticates using the BodyAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(BodyAuthGuard)
  @Post()
  login(@Req() request: Request): User {
    return request.user as User;
  }

  /**
   * Logout endpoint. This only tells the browser to set a invalid cookie.
   * It does not un-validate existing cookies.
   * @param response
   */
  @Delete()
  logout(@Response() response) {
    response.cookie(TOKEN_KEY, '', { httpOnly: true });
    response.send({ ok: true });
  }

  /**
   * Retrieve information about currently logged-in user.
   * This supports cookie and basic auth.
   */
  @Get()
  async session(@Req() req, @Response() response) {
    await this.combinedAuth
      .use(req, response, () => {})
      // unsuccessful login
      .catch(() => (req.user = { name: null, roles: [] }))
      // send back user object
      .then(() => response.send({ ok: true, userCtx: req.user }));
  }
}
