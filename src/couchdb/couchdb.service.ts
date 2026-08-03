import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
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

/** lowest HTTP status that does not indicate success */
const FIRST_NON_SUCCESS_STATUS = 300;

/** the parts of a rejected axios request this service maps to an exception */
interface AxiosErrorLike {
  message?: string;
  response?: { status: number; data: unknown };
}

@Injectable()
export class CouchdbService {
  static readonly DATABASE_USER_ENV = 'DATABASE_USER';
  static readonly DATABASE_PASSWORD_ENV = 'DATABASE_PASSWORD';
  static readonly DATABASE_URL_ENV = 'DATABASE_URL';

  /** upper bounds for buffering the body of a failed stream request */
  private static readonly MAX_ERROR_BODY_BYTES = 64 * 1024;
  private static readonly ERROR_BODY_TIMEOUT_MS = 5_000;

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
    this.httpService.axiosRef.interceptors.response.use(undefined, (err) =>
      Promise.reject(this.toNestException(err)),
    );
  }

  /**
   * Map an axios error to the exception the client should receive.
   *
   * A request that failed even though CouchDB had answered with a success
   * status (a body cut short, for example) must not keep that status: the
   * incomplete response would reach the client looking like a complete one.
   */
  private toNestException(err: AxiosErrorLike): Error {
    const response = err.response;
    if (!response) {
      return err as Error;
    }
    if (response.status < FIRST_NON_SUCCESS_STATUS) {
      return new HttpException(
        { error: 'bad_gateway', reason: err.message ?? 'incomplete response' },
        HttpStatus.BAD_GATEWAY,
      );
    }
    return new HttpException(
      response.data as string | Record<string, unknown>,
      response.status,
    );
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
   * The axios error interceptor wraps error responses in HttpExceptions,
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
    const text = await this.readBoundedText(body);
    if (text === undefined) {
      return new HttpException(
        { error: 'unreadable_error_body' },
        error.getStatus(),
      );
    }
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

  /**
   * Read a CouchDB error body as text, giving up once it exceeds
   * {@link MAX_ERROR_BODY_BYTES} or stalls for {@link ERROR_BODY_TIMEOUT_MS},
   * so an oversized or hanging body cannot grow memory or block the request.
   *
   * @returns the body text, or undefined if it could not be read within those bounds
   */
  private async readBoundedText(body: Readable): Promise<string | undefined> {
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(
      () => body.destroy(),
      CouchdbService.ERROR_BODY_TIMEOUT_MS,
    ).unref();
    try {
      for await (const chunk of body) {
        size += chunk.length;
        if (size > CouchdbService.MAX_ERROR_BODY_BYTES) {
          return undefined;
        }
        chunks.push(Buffer.from(chunk));
      }
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
      body.destroy();
    }
    return Buffer.concat(chunks).toString();
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
