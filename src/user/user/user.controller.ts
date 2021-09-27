import {
  Controller,
  Get,
  Param,
  Headers,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../../replication/couch-proxy/couch-proxy.controller';
import { User } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { ApiBasicAuth } from '@nestjs/swagger';
import { DocSuccess } from '../../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';

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
    return this.httpService
      .get<User>(this.getUserUrl(username), {
        headers: { Authorization: authHeader },
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

  async putUser(
    @Param('username') username: string,
    @Body() reqUser: { password: string },
    @Headers('Authorization') authHeader: string,
  ): Promise<DocSuccess> {
    const dbUser = await firstValueFrom(this.getUser(username, authHeader));
    const userWithPass = Object.assign(dbUser, { password: reqUser.password });
    return firstValueFrom(
      this.httpService
        .put<DocSuccess>(this.getUserUrl(username), userWithPass, {
          auth: { username: this.admin_user, password: this.admin_pass },
        })
        .pipe(map((response) => response.data)),
    );
  }

  private getUserUrl(username: string): string {
    return this.databaseUrl + '/_users/' + username;
  }
}
