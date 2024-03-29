import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { catchError, map, Observable } from 'rxjs';
import {
  DatabaseDocument,
  DocSuccess,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import {
  SessionResponse,
  UserInfo,
} from '../restricted-endpoints/session/user-auth.dto';
import { AxiosResponse } from 'axios';

@Injectable()
export class CouchdbService {
  static readonly DATABASE_USER_ENV = 'DATABASE_USER';
  static readonly DATABASE_PASSWORD_ENV = 'DATABASE_PASSWORD';
  static readonly DATABASE_URL_ENV = 'DATABASE_URL';

  /**
   * The URL to the CouchDB instance
   */
  readonly databaseUrl: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.databaseUrl = this.configService.get<string>(
      CouchdbService.DATABASE_URL_ENV,
    );

    this.initAddBasicAuthHeaderByDefault();
    this.initMapAxiosErrorsToNestjsExceptions();
  }

  private initAddBasicAuthHeaderByDefault() {
    this.httpService.axiosRef.defaults.auth = {
      username: this.configService.get<string>(
        CouchdbService.DATABASE_USER_ENV,
      ),
      password: this.configService.get<string>(
        CouchdbService.DATABASE_PASSWORD_ENV,
      ),
    };
  }

  private initMapAxiosErrorsToNestjsExceptions() {
    this.httpService.axiosRef.interceptors.response.use(undefined, (err) => {
      const resultErr = err.response
        ? new HttpException(err.response.data, err.response.status)
        : err;
      return Promise.reject(resultErr);
    });
  }

  head(
    databaseName?: string,
    documentId?: string,
    params?: any,
  ): Observable<AxiosResponse> {
    return this.httpService.head(this.buildDocUrl(databaseName, documentId), {
      params,
    });
  }

  get<T extends DatabaseDocument = DatabaseDocument>(
    databaseName?: string,
    documentId?: string,
    params?: any,
  ): Observable<T> {
    return this.httpService
      .get<T>(this.buildDocUrl(databaseName, documentId), { params })
      .pipe(map((response) => response.data));
  }

  private buildDocUrl(db?: string, documentId?: string): string {
    let url = `${this.databaseUrl}/`;
    if (db) {
      url += `${db}/`;
    }
    if (documentId) {
      url += documentId;
    }
    return url;
  }

  put(dbName: string, document: DatabaseDocument): Observable<DocSuccess> {
    return this.httpService
      .put<DocSuccess>(this.buildDocUrl(dbName, document._id), document)
      .pipe(map((response) => response.data));
  }

  post<T>(
    dbName: string,
    documentID: string,
    body: any,
    params?: any,
  ): Observable<T> {
    return this.httpService
      .post<T>(this.buildDocUrl(dbName, documentID), body, { params })
      .pipe(map((res) => res.data));
  }

  delete(db: string, id: string, params?: any): Observable<any> {
    return this.httpService
      .delete(this.buildDocUrl(db, id), { params })
      .pipe(map((res) => res.data));
  }

  login(username: string, password: string): Observable<UserInfo> {
    return this.httpService
      .get<SessionResponse>(`${this.databaseUrl}/_session`, {
        auth: {
          username: username,
          password: password,
        },
      })
      .pipe(
        map((res) => res.data.userCtx),
        catchError(() => {
          throw new UnauthorizedException();
        }),
      );
  }
}
