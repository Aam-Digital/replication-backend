import { Injectable, UnauthorizedException } from '@nestjs/common';
import { User } from '../session/session/user-auth.dto';
import {
  DatabaseDocument,
  DocSuccess,
} from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { firstValueFrom, map } from 'rxjs';
import { CouchDBInteracter } from '../utils/couchdb-interacter';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { PermissionService } from '../permissions/permission/permission.service';
import { permittedFieldsOf } from '@casl/ability/extra';
import * as _ from 'lodash';

@Injectable()
export class UserService extends CouchDBInteracter {
  constructor(
    httpService: HttpService,
    configService: ConfigService,
    private permissionService: PermissionService,
  ) {
    super(httpService, configService);
  }

  async getUserObject(
    username: string,
    requestingUser: User,
  ): Promise<DatabaseDocument> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const userDoc = await firstValueFrom(
      this.httpService
        .get<DatabaseDocument>(this.getUserUrl(username))
        .pipe(map((response) => response.data)),
    );
    if (userAbility.can('read', userDoc)) {
      return userDoc;
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  private getUserUrl(username: string): string {
    return this.databaseUrl + '/_users/' + username;
  }

  async updateUserObject(
    userDoc: DatabaseDocument,
    requestingUser: User,
  ): Promise<DocSuccess> {
    const userAbility = this.permissionService.getAbilityFor(requestingUser);
    const oldUser = await this.getUserObject(userDoc._id, requestingUser);
    if (!oldUser && userAbility.can('create', userDoc)) {
      // Creating
      return this.putUserObject(userDoc);
    } else if (userAbility.can('update', oldUser)) {
      // Updating
      const permittedFields = permittedFieldsOf(
        userAbility,
        'update',
        oldUser,
        {
          fieldsFrom: (rule) => rule.fields || [],
        },
      );
      if (permittedFields.length > 0) {
        // Updating some properties
        const updatedFields = _.pick(userDoc, permittedFields);
        const updatedUser = Object.assign(oldUser, updatedFields);
        return this.putUserObject(updatedUser);
      } else {
        // Updating whole document
        return this.putUserObject(userDoc);
      }
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  private putUserObject(newUserObject): Promise<DocSuccess> {
    return firstValueFrom(
      this.httpService
        .put<DocSuccess>(this.getUserUrl(newUserObject._id), newUserObject)
        .pipe(map((response) => response.data)),
    );
  }
}
