import { ConfigService } from '@nestjs/config';
import {
  couchdbHttpOptions,
  DATABASE_MAX_SOCKETS_ENV,
  DATABASE_TIMEOUT_ENV,
  DEFAULT_DATABASE_MAX_SOCKETS,
  DEFAULT_DATABASE_TIMEOUT_MS,
} from './couchdb.module';

/** read the (untyped) constructor options back from an http(s).Agent */
function agentOptions(agent: unknown): {
  keepAlive?: boolean;
  maxSockets?: number;
} {
  return (
    agent as { options: { keepAlive?: boolean; maxSockets?: number } }
  ).options;
}

describe('couchdbHttpOptions', () => {
  it('applies a default timeout and keep-alive agents with a socket cap', () => {
    const options = couchdbHttpOptions(new ConfigService({}));

    expect(options.timeout).toBe(DEFAULT_DATABASE_TIMEOUT_MS);
    expect(agentOptions(options.httpAgent)).toMatchObject({
      keepAlive: true,
      maxSockets: DEFAULT_DATABASE_MAX_SOCKETS,
    });
    expect(agentOptions(options.httpsAgent)).toMatchObject({
      keepAlive: true,
      maxSockets: DEFAULT_DATABASE_MAX_SOCKETS,
    });
  });

  it('allows overriding timeout and socket cap via environment config', () => {
    const options = couchdbHttpOptions(
      new ConfigService({
        [DATABASE_TIMEOUT_ENV]: '120000',
        [DATABASE_MAX_SOCKETS_ENV]: '10',
      }),
    );

    expect(options.timeout).toBe(120000);
    expect(agentOptions(options.httpAgent).maxSockets).toBe(10);
    expect(agentOptions(options.httpsAgent).maxSockets).toBe(10);
  });

  it('falls back to defaults for invalid values', () => {
    const options = couchdbHttpOptions(
      new ConfigService({
        [DATABASE_TIMEOUT_ENV]: 'not-a-number',
        [DATABASE_MAX_SOCKETS_ENV]: '',
      }),
    );

    expect(options.timeout).toBe(DEFAULT_DATABASE_TIMEOUT_MS);
    expect(agentOptions(options.httpAgent).maxSockets).toBe(
      DEFAULT_DATABASE_MAX_SOCKETS,
    );
  });
});
