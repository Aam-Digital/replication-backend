import {
  Controller,
  Get,
  Param,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../../replication/couch-proxy/couch-proxy.controller';
import { User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { catchError, map, Observable } from 'rxjs';
import { ApiBasicAuth } from '@nestjs/swagger';

@ApiBasicAuth()
@Controller('_users')
export class UserController {
  private readonly databaseUrl: string;
  private readonly admin_user: string;
  private readonly admin_pass: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.admin_user = this.configService.get<string>(
      CouchProxyController.DATABASE_USER_ENV,
    );
    this.admin_pass = this.configService.get<string>(
      CouchProxyController.DATABASE_PASSWORD_ENV,
    );
    this.databaseUrl = this.configService.get<string>(
      CouchProxyController.DATABASE_URL_ENV,
    );
  }

  @Get('/:username')
  getUser(
    @Param('username') username: string,
    @Headers('Authorization') authHeader: string,
  ): Observable<User> {
    const userUrl = this.databaseUrl + '/_users/' + username;
    return this.httpService
      .get<User>(userUrl, {
        headers: { authorization: authHeader },
      })
      .pipe(
        map((response) => response.data),
        catchError(() => {
          throw new UnauthorizedException(
            'unauthorized',
            'Name or password is incorrect.',
          );
        }),
      );
  }
}
