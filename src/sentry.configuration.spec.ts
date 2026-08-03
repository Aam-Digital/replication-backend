import {
  BadGatewayException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import * as Sentry from '@sentry/node';
import { beforeSend, normalizeLogMessage } from './sentry.configuration';

describe('normalizeLogMessage', () => {
  it('keeps a constant message unchanged', () => {
    const message = 'Failed to fetch Keycloak user';

    expect(normalizeLogMessage(message)).toBe(message);
  });

  it('groups messages that interpolate a user id', () => {
    const a = normalizeLogMessage(
      'Failed to fetch Keycloak user 5b8c774c-f2a9-4407-ad2e-a5325168b8e9',
    );
    const b = normalizeLogMessage(
      'Failed to fetch Keycloak user 1a2b3c4d-9999-4eee-8fff-abcdef012345',
    );

    expect(a).toBe(b);
  });

  it('groups messages that differ only in a counter', () => {
    // the earlier prefix-before-first-colon heuristic split these, because the
    // counter appears before the colon
    const a = normalizeLogMessage('Changes feed error (failure #1): timeout');
    const b = normalizeLogMessage('Changes feed error (failure #2): timeout');

    expect(a).toBe(b);
  });

  it('groups messages that differ only in a host or url', () => {
    const a = normalizeLogMessage('connect ECONNREFUSED 192.168.64.8:5984');
    const b = normalizeLogMessage('connect ECONNREFUSED 172.20.0.4:5984');
    const c = normalizeLogMessage('request to https://example.org/db failed');
    const d = normalizeLogMessage('request to https://other.example/db failed');

    expect(a).toBe(b);
    expect(c).toBe(d);
  });

  it('keeps genuinely different messages apart', () => {
    const a = normalizeLogMessage('Failed to fetch Keycloak user');
    const b = normalizeLogMessage('Failed to obtain Keycloak access token');

    expect(a).not.toBe(b);
  });
});

describe('beforeSend', () => {
  function event(
    overrides: Partial<Sentry.ErrorEvent> = {},
  ): Sentry.ErrorEvent {
    return { type: undefined, ...overrides } as Sentry.ErrorEvent;
  }

  function hint(originalException?: unknown): Sentry.EventHint {
    return { originalException } as Sentry.EventHint;
  }

  it('drops 4xx HttpExceptions, which are client errors rather than faults', () => {
    const result = beforeSend(
      event(),
      hint(new HttpException('not found', 404)),
    );

    expect(result).toBeNull();
  });

  it('reports 5xx HttpExceptions', () => {
    const result = beforeSend(event(), hint(new HttpException('boom', 500)));

    expect(result).not.toBeNull();
  });

  it('fingerprints operation-specific failures by status and route so unrelated CouchDB faults do not merge', () => {
    const result = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 500)),
    );

    expect(result?.fingerprint).toEqual([
      'HttpException',
      '500',
      'POST /:db/_bulk_docs',
    ]);
  });

  it.each([
    ['Bad Gateway', 502],
    ['Service Unavailable', 503],
    ['Gateway Timeout', 504],
  ])(
    'groups a generic %s by status alone, so one outage is not split per route',
    (_name, status) => {
      const bulkDocs = beforeSend(
        event({ transaction: 'POST /:db/_bulk_docs' }),
        hint(new HttpException('boom', status)),
      );
      const allDocs = beforeSend(
        event({ transaction: 'GET /:db/_all_docs' }),
        hint(new HttpException('boom', status)),
      );

      expect(bulkDocs?.fingerprint).toEqual(['HttpException', String(status)]);
      expect(bulkDocs?.fingerprint).toEqual(allDocs?.fingerprint);
    },
  );

  it('still separates different upstream-availability statuses from each other', () => {
    const badGateway = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 502)),
    );
    const unavailable = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 503)),
    );

    expect(badGateway?.fingerprint).not.toEqual(unavailable?.fingerprint);
  });

  it('separates the same status on different routes', () => {
    const bulkDocs = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 500)),
    );
    const allDocs = beforeSend(
      event({ transaction: 'GET /:db/_all_docs' }),
      hint(new HttpException('boom', 500)),
    );

    expect(bulkDocs?.fingerprint).not.toEqual(allDocs?.fingerprint);
  });

  it('never merges an operation-specific failure with an upstream outage on the same route', () => {
    const serverError = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 500)),
    );
    const badGateway = beforeSend(
      event({ transaction: 'POST /:db/_bulk_docs' }),
      hint(new HttpException('boom', 502)),
    );

    expect(serverError?.fingerprint).not.toEqual(badGateway?.fingerprint);
  });

  it('falls back to an explicit placeholder when no route is known', () => {
    const result = beforeSend(event(), hint(new HttpException('boom', 500)));

    expect(result?.fingerprint).toEqual([
      'HttpException',
      '500',
      '<unknown route>',
    ]);
  });

  it('fingerprints plain log messages using normalizeLogMessage', () => {
    const message = 'Changes feed error (failure #1): timeout';
    const result = beforeSend(event({ message }), hint());

    expect(result?.fingerprint).toEqual([normalizeLogMessage(message)]);
  });

  it('prefers the status/route fingerprint over the normalized message for HttpExceptions', () => {
    const result = beforeSend(
      event({
        message: 'Request failed: something dynamic',
        transaction: 'GET /:db/_changes',
      }),
      hint(new HttpException('boom', 500)),
    );

    expect(result?.fingerprint).toEqual([
      'HttpException',
      '500',
      'GET /:db/_changes',
    ]);
  });

  it('passes through non-HttpException errors without a message unchanged', () => {
    const result = beforeSend(event(), hint(new Error('kaboom')));

    expect(result).not.toBeNull();
    expect(result?.fingerprint).toBeUndefined();
  });

  describe('purpose-built exceptions on the same route', () => {
    // PermissionCheckController's single `POST /permissions/check` route can
    // throw a 502 BadGatewayException for two unrelated dependencies failing:
    // Keycloak being unreachable, or the canonical entity document failing to
    // load from CouchDB. Status+route alone can't tell those apart; the message
    // — chosen by each call site, not by request data — has to.
    const keycloakDown = () =>
      new BadGatewayException('Upstream identity provider is unavailable');
    const couchdbLoadFailed = () =>
      new BadGatewayException('Failed to load target entity document');

    it('separates unrelated dependency failures that share a status and route', () => {
      const keycloak = beforeSend(
        event({ transaction: 'POST /permissions/check' }),
        hint(keycloakDown()),
      );
      const couchdb = beforeSend(
        event({ transaction: 'POST /permissions/check' }),
        hint(couchdbLoadFailed()),
      );

      expect(keycloak?.fingerprint).not.toEqual(couchdb?.fingerprint);
    });

    it('still groups repeats of the same dependency failure across requests', () => {
      const first = beforeSend(
        event({ transaction: 'POST /permissions/check' }),
        hint(keycloakDown()),
      );
      const second = beforeSend(
        event({ transaction: 'POST /permissions/check' }),
        hint(keycloakDown()),
      );

      expect(first?.fingerprint).toEqual(second?.fingerprint);
    });

    it('normalizes an id interpolated into an otherwise-static message', () => {
      const userA = beforeSend(
        event(),
        hint(
          new InternalServerErrorException(
            'Could not resolve entity name for user 5b8c774c-f2a9-4407-ad2e-a5325168b8e9',
          ),
        ),
      );
      const userB = beforeSend(
        event(),
        hint(
          new InternalServerErrorException(
            'Could not resolve entity name for user 1a2b3c4d-9999-4eee-8fff-abcdef012345',
          ),
        ),
      );

      expect(userA?.fingerprint).toEqual(userB?.fingerprint);
    });
  });
});
