import {
  Controller,
  Delete,
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

@Controller('/_session')
export class SessionController {
  /**
   * Login endpoint.
   * Authenticates using the BodyAuthGuard.
   */
  @ApiBody({ type: UserCredentials })
  @UseGuards(BodyAuthGuard)
  @Post()
  login(@Req() request: Request): User {
    return request.user as any;
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
}
