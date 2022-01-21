import {
  Controller,
  Get,
  Param,
  Body,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { User } from '../session/session/user-auth.dto';
import { ApiBasicAuth } from '@nestjs/swagger';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { UserService } from './user.service';
import { Request } from 'express';
import { BasicAuthGuard } from '../session/guards/basic-auth/basic-auth-guard.service';

/**
 * This controller handles the interaction with the CouchDB _users database.
 * This includes fetching user documents and changing the password of an existing user.
 * For more information see {@link https://docs.couchdb.org/en/stable/intro/security.html#security}
 */
@ApiBasicAuth()
@UseGuards(BasicAuthGuard)
@Controller('_users')
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * Fetch a user document with basic auth.
   * Users can fetch only their own document.
   * @param username the name of the user with the 'org.couchdb.user:' prefix
   * @param request the request object holding the user executing the request
   */
  @Get('/:username')
  getUser(
    @Param('username') username: string,
    @Req() request: Request,
  ): Promise<DatabaseDocument> {
    const authenticatedUser = request.user as User;
    return this.userService.getUserObject(username, authenticatedUser);
  }

  /**
   * Update the user document with a new password.
   * Users can only update their own document.
   * @param userDoc a object from which only the password property will be used
   * @param request the request object holding the user executing the request
   */
  @Put('/:username')
  async putUser(
    @Body() userDoc: DatabaseDocument,
    @Req() request: Request,
  ): Promise<DocSuccess> {
    const requestingUser = request.user as User;
    return this.userService.updateUserObject(userDoc, requestingUser);
  }
}
