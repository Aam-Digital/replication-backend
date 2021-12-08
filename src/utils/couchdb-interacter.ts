import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/**
 * This class automatically sets up everything that is needed to communicated with the remote CouchDB
 */
export abstract class CouchDBInteracter {
  static readonly DATABASE_USER_ENV = 'DATABASE_USER';
  static readonly DATABASE_PASSWORD_ENV = 'DATABASE_PASSWORD';
  static readonly DATABASE_URL_ENV = 'DATABASE_URL';
  static readonly DATABASE_NAME_ENV = 'DATABASE_NAME';

  /**
   * The URL to the CouchDB instance
   */
  readonly databaseUrl: string;
  /**
   * The name of the specific database inside the CouchDB instance
   */
  readonly databaseName: string;

  constructor(
    public httpService: HttpService,
    public configService: ConfigService,
  ) {
    // Send the basic auth header with every request
    this.httpService.axiosRef.defaults.auth = {
      username: this.configService.get<string>(
        CouchDBInteracter.DATABASE_USER_ENV,
      ),
      password: this.configService.get<string>(
        CouchDBInteracter.DATABASE_PASSWORD_ENV,
      ),
    };

    this.databaseUrl = this.configService.get<string>(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
    this.databaseName = this.configService.get<string>(
      CouchDBInteracter.DATABASE_NAME_ENV,
    );
  }
}
