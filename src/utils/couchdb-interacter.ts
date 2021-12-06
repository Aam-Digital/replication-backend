import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

export abstract class CouchDBInteracter {
  static readonly DATABASE_USER_ENV = 'DATABASE_USER';
  static readonly DATABASE_PASSWORD_ENV = 'DATABASE_PASSWORD';
  static readonly DATABASE_URL_ENV = 'DATABASE_URL';
  static readonly DATABASE_NAME_ENV = 'DATABASE_NAME';

  readonly username: string;
  readonly password: string;
  readonly databaseUrl: string;
  readonly databaseName: string;

  constructor(
    public httpService: HttpService,
    public configService: ConfigService,
  ) {
    this.username = this.configService.get<string>(
      CouchDBInteracter.DATABASE_USER_ENV,
    );
    this.password = this.configService.get<string>(
      CouchDBInteracter.DATABASE_PASSWORD_ENV,
    );
    // Send the basic auth header with every request
    this.httpService.axiosRef.defaults.auth = {
      username: this.username,
      password: this.password,
    };

    this.databaseUrl = this.configService.get<string>(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
    this.databaseName = this.configService.get<string>(
      CouchDBInteracter.DATABASE_NAME_ENV,
    );
  }
}