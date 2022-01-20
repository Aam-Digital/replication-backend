import { Injectable } from '@nestjs/common';
import { User, UserPassword } from '../session/session/user-auth.dto';
import { DocSuccess } from '../replication/couch-proxy/couchdb-dtos/bulk-docs.dto';
import { firstValueFrom, map } from 'rxjs';
import { CouchDBInteracter } from '../utils/couchdb-interacter';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UserService extends CouchDBInteracter {
  constructor(httpService: HttpService, configService: ConfigService) {
    super(httpService, configService);
  }

  updateUserObject(
    oldUser: User,
    newUser: UserPassword | (User & UserPassword),
  ): Promise<DocSuccess> {
    const userWithPass = Object.assign(oldUser, { password: newUser.password });
    const userUrl =
      this.databaseUrl + '/_users/org.couchdb.user:' + oldUser.name;
    return firstValueFrom(
      this.httpService
        .put<DocSuccess>(userUrl, userWithPass)
        .pipe(map((response) => response.data)),
    );
  }
}
