import { normalizeLogMessage } from './sentry.configuration';

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
