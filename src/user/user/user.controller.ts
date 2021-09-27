import {
  Controller,
  Get,
  Param,
  Headers,
  UnauthorizedException,
  Body,
  Put,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../../replication/couch-proxy/couch-proxy.controller';
import { User, UserPassword } from '../../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { ApiBasicAuth } from '@nestjs/swagger';
import { DocSuccess } from '../../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';

/**
 * This controller handles the interaction with the CouchDB _users database.
 * This includes fetching user documents and changing the password of a existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 */
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

  /**
   * Fetch a user document with basic auth.
   * Users can fetch only their own document.
   * @param username the name of the user with the 'org.couchdb.user:' prefix
   * @param authHeader the header which is automatically created when sending a request with basic auth
   */
  @Get('/:username')
  getUser(
    @Param('username') username: string,
    @Headers('Authorization') authHeader: string,
  ): Observable<User> {
    return this.httpService
      .get<User>(this.getUserUrl(username), {
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

  /**
   * Update the user document with a new password.
   * Users can only update their own document.
   * @param username the name of the user with the 'org.couchdb.user:' prefix
   * @param reqUser a object from which only the password property will be used
   * @param authHeader the basic auth header used to verify credentials of the user
   */
  @Put('/:username')
  async putUser(
    @Param('username') username: string,
    @Body() reqUser: UserPassword,
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
