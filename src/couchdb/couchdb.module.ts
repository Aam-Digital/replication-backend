import { HttpModule, HttpModuleOptions } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { CouchdbService } from './couchdb.service';
import { DocumentChangesService } from './document-changes.service';

/**
 * (optional) env var: per-request timeout in ms for requests to CouchDB.
 * Must stay above ~55s — the internal changes feed uses 50s longpoll
 * requests that must not be aborted client-side.
 */
export const DATABASE_TIMEOUT_ENV = 'DATABASE_TIMEOUT_MS';
/** (optional) env var: maximum number of parallel connections to CouchDB */
export const DATABASE_MAX_SOCKETS_ENV = 'DATABASE_MAX_SOCKETS';

export const DEFAULT_DATABASE_TIMEOUT_MS = 60_000;
export const DEFAULT_DATABASE_MAX_SOCKETS = 50;

/**
 * HTTP client options for all requests to CouchDB:
 *
 * - a request timeout, so that a hung CouchDB connection (e.g. half-open
 *   socket) fails the request and triggers retries instead of hanging the
 *   client forever
 * - keep-alive agents with a socket cap, so request bursts reuse
 *   connections instead of opening an unbounded number of new ones
 */
export function couchdbHttpOptions(
  configService: ConfigService,
): HttpModuleOptions {
  const timeout =
    Number(configService.get(DATABASE_TIMEOUT_ENV)) ||
    DEFAULT_DATABASE_TIMEOUT_MS;
  const maxSockets =
    Number(configService.get(DATABASE_MAX_SOCKETS_ENV)) ||
    DEFAULT_DATABASE_MAX_SOCKETS;
  const agentOptions = { keepAlive: true, maxSockets };
  return {
    timeout,
    httpAgent: new HttpAgent(agentOptions),
    httpsAgent: new HttpsAgent(agentOptions),
  };
}

@Global()
@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: couchdbHttpOptions,
    }),
  ],
  providers: [CouchdbService, DocumentChangesService],
  exports: [CouchdbService, DocumentChangesService],
})
export class CouchdbModule {}
