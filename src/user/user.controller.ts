import {
  Controller,
  Get,
  Param,
  Headers,
  UnauthorizedException,
  Body,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouchProxyController } from '../replication/couch-proxy/couch-proxy.controller';
import { User } from '../session/session/user-auth.dto';
import { HttpService } from '@nestjs/axios';
import { catchError, firstValueFrom, map, Observable } from 'rxjs';
import { ApiBasicAuth } from '@nestjs/swagger';
import { DatabaseDocument, DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { UserService } from './user.service';
import { Request } from 'express';
import { BasicAuthGuard } from '../session/guards/basic-auth/basic-auth-guard.service';

/**
 * This controller handles the interaction with the CouchDB _users database.
 * This includes fetching user documents and changing the password of a existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 */
@ApiBasicAuth()
@Controller('_users')
export class UserController {
  private readonly databaseUrl: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
    private userService: UserService,
  ) {
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
  ): Observable<DatabaseDocument> {
    return this.httpService
      .get<DatabaseDocument>(this.getUserUrl(username), {
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
   * @param updatedUser a object from which only the password property will be used
   * @param authHeader the basic auth header used to verify credentials of the user
   * @param request the request object holding the user executing the request
   */
  @UseGuards(BasicAuthGuard)
  @Put('/:username')
  async putUser(
    @Param('username') username: string,
    @Body() updatedUser: DatabaseDocument,
    @Headers('Authorization') authHeader: string,
    @Req() request: Request,
  ): Promise<DocSuccess> {
    const authenticatedUser = request.user as User;
    const userBeforeUpdate = await firstValueFrom(
      this.getUser(username, authHeader),
    );
    return this.userService.updateUserObject(
      userBeforeUpdate,
      updatedUser,
      authenticatedUser,
    );
  }

  private getUserUrl(username: string): string {
    return this.databaseUrl + '/_users/' + username;
  }
}
