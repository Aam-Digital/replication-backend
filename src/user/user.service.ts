import { Injectable, UnauthorizedException } from '@nestjs/common';
import { COUCHDB_USER_DOC, User } from '../session/session/user-auth.dto';
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

  async updateUserObject(
    oldUser: DatabaseDocument,
    newUser: DatabaseDocument,
    loggedInUser: User,
  ): Promise<DocSuccess> {
    const userAbility = this.permissionService.getAbilityFor(loggedInUser);
    if (!oldUser && userAbility.can('create', newUser)) {
      // Creating
      return this.putUserObject(newUser);
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
        const updatedFields = _.pick(newUser, permittedFields);
        const updatedUser = Object.assign(oldUser, updatedFields);
        return this.putUserObject(updatedUser);
      } else {
        // Updating whole document
        return this.putUserObject(newUser);
      }
    } else {
      throw new UnauthorizedException('unauthorized', 'User is not permitted');
    }
  }

  private putUserObject(newUserObject): Promise<DocSuccess> {
    const userUrl = `${this.databaseUrl}/_users/${COUCHDB_USER_DOC}:${newUserObject.name}`;
    return firstValueFrom(
      this.httpService
        .put<DocSuccess>(userUrl, newUserObject)
        .pipe(map((response) => response.data)),
    );
  }
}
