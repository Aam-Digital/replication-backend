import {
  exponentialBackoffDelay,
  ExponentialBackoff,
} from './exponential-backoff';

describe('exponentialBackoffDelay', () => {
  it('doubles the delay with each attempt up to the cap', () => {
    const opts = { initialMs: 1000, maxMs: 60_000 };

    expect(exponentialBackoffDelay(0, opts)).toBe(1000);
    expect(exponentialBackoffDelay(1, opts)).toBe(2000);
    expect(exponentialBackoffDelay(2, opts)).toBe(4000);
    expect(exponentialBackoffDelay(3, opts)).toBe(8000);
    expect(exponentialBackoffDelay(4, opts)).toBe(16_000);
    expect(exponentialBackoffDelay(5, opts)).toBe(32_000);
    expect(exponentialBackoffDelay(6, opts)).toBe(60_000);
    expect(exponentialBackoffDelay(100, opts)).toBe(60_000);
  });

  it('respects the maxMs cap before reaching maxExponent', () => {
    expect(
      exponentialBackoffDelay(10, { initialMs: 1000, maxMs: 10_000 }),
    ).toBe(10_000);
  });

  it('clamps negative attempts to the initial delay', () => {
    expect(exponentialBackoffDelay(-5, { initialMs: 500, maxMs: 60_000 })).toBe(
      500,
    );
  });

  it('uses default options when none are provided', () => {
    // Defaults: initialMs=1000, maxMs=60_000.
    expect(exponentialBackoffDelay(0)).toBe(1000);
    expect(exponentialBackoffDelay(6)).toBe(60_000);
  });
});

describe('ExponentialBackoff', () => {
  it('returns increasing delays on consecutive failures and resets', () => {
    const backoff = new ExponentialBackoff();

    expect(backoff.failureCount).toBe(0);
    expect(backoff.currentDelay).toBe(0);

    expect(backoff.recordFailure()).toBe(1000);
    expect(backoff.recordFailure()).toBe(2000);
    expect(backoff.recordFailure()).toBe(4000);
    expect(backoff.failureCount).toBe(3);

    backoff.reset();
    expect(backoff.failureCount).toBe(0);
    expect(backoff.currentDelay).toBe(0);
  });

  it('reports saturation only once the cap is reached', () => {
    const backoff = new ExponentialBackoff({ initialMs: 1000, maxMs: 4000 });

    backoff.recordFailure(); // 1000
    expect(backoff.isSaturated).toBe(false);
    expect(backoff.justSaturated).toBe(false);

    backoff.recordFailure(); // 2000
    expect(backoff.isSaturated).toBe(false);

    backoff.recordFailure(); // 4000 → cap
    expect(backoff.isSaturated).toBe(true);
    expect(backoff.justSaturated).toBe(true);

    backoff.recordFailure(); // still 4000
    expect(backoff.isSaturated).toBe(true);
    expect(backoff.justSaturated).toBe(false);
  });
});
