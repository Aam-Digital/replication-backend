import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

/**
 * This class automatically sets up everything that is needed to communicated with the remote CouchDB
 */
export abstract class CouchDBInteracter {
  static readonly DATABASE_USER_ENV = 'DATABASE_USER';
  static readonly DATABASE_PASSWORD_ENV = 'DATABASE_PASSWORD';
  static readonly DATABASE_URL_ENV = 'DATABASE_URL';

  /**
   * The URL to the CouchDB instance
   */
  readonly databaseUrl: string;

  constructor(
    public httpService: HttpService,
    public configService: ConfigService,
  ) {
    this.databaseUrl = this.configService.get<string>(
      CouchDBInteracter.DATABASE_URL_ENV,
    );
  }
}
