import {
  Controller,
  Delete,
  Get,
  Post,
  Response,
  UseGuards,
} from '@nestjs/common';
import { UserInfo, UserCredentials, SessionResponse } from './user-auth.dto';
import { BodyAuthGuard } from '../../auth/guards/body-auth/body-auth.guard';
import { ApiBody } from '@nestjs/swagger';
import { TOKEN_KEY } from '../../auth/cookie/cookie.service';
import { CombinedAuthGuard } from '../../auth/guards/combined-auth/combined-auth.guard';
import { User } from '../../auth/user.decorator';

@Controller('/_session')
export class SessionController {
  /**
   * Login endpoint.
   * Authenticates using the BodyAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(BodyAuthGuard)
  @Post()
  login(@User() user: UserInfo): UserInfo {
    return user;
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
  @UseGuards(CombinedAuthGuard)
  @Get()
  session(@User() user: UserInfo): SessionResponse {
    return { ok: true, userCtx: user };
  }
}
