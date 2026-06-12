import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse, Method } from 'axios';
import { catchError, map, Observable, of } from 'rxjs';
import { Readable } from 'stream';
import {
  DatabaseDocument,
  DocSuccess,
} from '../restricted-endpoints/replication/bulk-document/couchdb-dtos/bulk-docs.dto';
import {
  SessionResponse,
  UserInfo,
} from '../restricted-endpoints/session/user-auth.dto';

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
    this.databaseUrl = this.requireEnv(CouchdbService.DATABASE_URL_ENV);

    this.initAddBasicAuthHeaderByDefault();
    this.initMapAxiosErrorsToNestjsExceptions();
  }

  private requireEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }

  private initAddBasicAuthHeaderByDefault() {
    this.httpService.axiosRef.defaults.auth = {
      username: this.requireEnv(CouchdbService.DATABASE_USER_ENV),
      password: this.requireEnv(CouchdbService.DATABASE_PASSWORD_ENV),
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
    params?: Record<string, unknown>,
  ): Observable<AxiosResponse> {
    return this.httpService.head(this.buildDocUrl(databaseName, documentId), {
      params,
    });
  }

  get<T = DatabaseDocument>(
    databaseName?: string,
    documentId?: string,
    params?: Record<string, unknown>,
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

  /**
   * Create a database. Resolves successfully if it already exists (412).
   * Uses the proxy's admin credentials (applied to all requests by default).
   */
  createDb(dbName: string): Observable<{ ok: boolean }> {
    return this.httpService.put<{ ok: boolean }>(this.buildDocUrl(dbName)).pipe(
      map((response) => response.data),
      catchError((err) => {
        const status = err?.status ?? err?.getStatus?.();
        if (status === 412) {
          // database already exists
          return of({ ok: true });
        }
        throw err;
      }),
    );
  }

  /**
   * GET a CouchDB endpoint as a raw response stream (see {@link postStream}).
   */
  getStream(
    databaseName?: string,
    documentId?: string,
    params?: Record<string, unknown>,
  ): Promise<Readable> {
    return this.requestStream(
      'get',
      this.buildDocUrl(databaseName, documentId),
      undefined,
      params,
    );
  }

  /**
   * POST to a CouchDB endpoint and return the raw response body stream
   * instead of a buffered, parsed object.
   *
   * Used for large responses (_all_docs, _bulk_get, _find) that are
   * filtered and forwarded incrementally instead of being held in memory.
   *
   * Rejects with the same HttpException mapping as the buffered methods if
   * CouchDB responds with an error status.
   */
  postStream(
    dbName: string,
    documentID: string,
    body: unknown,
    params?: Record<string, unknown>,
  ): Promise<Readable> {
    return this.requestStream(
      'post',
      this.buildDocUrl(dbName, documentID),
      body,
      params,
    );
  }

  private async requestStream(
    method: Method,
    url: string,
    data: unknown,
    params?: Record<string, unknown>,
  ): Promise<Readable> {
    try {
      const response = await this.httpService.axiosRef.request<Readable>({
        method,
        url,
        data,
        params,
        responseType: 'stream',
        // axios does not decompress stream responses — request an
        // uncompressed body on this internal hop; client-facing compression
        // is applied separately by the compression middleware
        headers: { 'Accept-Encoding': 'identity' },
      });
      return response.data;
    } catch (error) {
      throw await this.toBufferedError(error);
    }
  }

  /**
   * The axios error interceptor wraps error responses in HttpExceptions —
   * but for stream requests the wrapped body is itself a stream. Read it
   * so callers get the same parsed-JSON HttpException as buffered methods.
   */
  private async toBufferedError(error: unknown): Promise<unknown> {
    if (!(error instanceof HttpException)) {
      return error;
    }
    const body = error.getResponse();
    if (!(body instanceof Readable)) {
      return error;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text if the error body is not JSON
    }
    return new HttpException(
      parsed as string | Record<string, unknown>,
      error.getStatus(),
    );
  }

  put(dbName: string, document: DatabaseDocument): Observable<DocSuccess> {
    return this.httpService
      .put<DocSuccess>(this.buildDocUrl(dbName, document._id), document)
      .pipe(map((response) => response.data));
  }

  post<T>(
    dbName: string,
    documentID: string,
    body: unknown,
    params?: Record<string, unknown>,
  ): Observable<T> {
    return this.httpService
      .post<T>(this.buildDocUrl(dbName, documentID), body, { params })
      .pipe(map((res) => res.data));
  }

  delete(
    db: string,
    id: string,
    params?: Record<string, unknown>,
  ): Observable<DocSuccess> {
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
