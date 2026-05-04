/**
 * Default options used by {@link ExponentialBackoff} when callers do not
 * override them. Tuned for retrying CouchDB-backed operations: start at 1s
 * and double up to a 60s cap.
 */
export const DEFAULT_BACKOFF_OPTIONS: Required<ExponentialBackoffOptions> = {
  initialMs: 1_000,
  maxMs: 60_000,
  maxExponent: 6,
};

/**
 * Options controlling {@link exponentialBackoffDelay} and
 * {@link ExponentialBackoff}.
 */
export interface ExponentialBackoffOptions {
  /** Base delay applied to the first retry (attempt = 0). */
  initialMs?: number;
  /** Upper bound on the returned delay. */
  maxMs?: number;
  /**
   * Cap on the exponent used when doubling, to prevent integer overflow on
   * pathologically long failure streaks. Default: 6 (i.e. up to 64× initialMs).
   */
  maxExponent?: number;
}

/**
 * Compute an exponential backoff delay (in milliseconds) for retrying a
 * failed operation:
 *
 *   delay = min(maxMs, initialMs * 2 ^ min(attempt, maxExponent))
 *
 * Callers decide how to count `attempt` — typically either the number of
 * consecutive failures (1-based) or the zero-based retry index. Either way,
 * higher values produce longer delays.
 */
export function exponentialBackoffDelay(
  attempt: number,
  options: ExponentialBackoffOptions = {},
): number {
  const { initialMs, maxMs, maxExponent } = {
    ...DEFAULT_BACKOFF_OPTIONS,
    ...options,
  };
  const safeAttempt = Math.max(0, Math.floor(attempt));
  const exponent = Math.min(safeAttempt, maxExponent);
  return Math.min(maxMs, initialMs * 2 ** exponent);
}

/**
 * Stateful helper for orchestrating retries with exponential backoff.
 *
 * Tracks the consecutive failure count and exposes the current delay along
 * with whether the backoff has reached its cap. This centralises the
 * accounting that retry loops would otherwise duplicate (failure counter,
 * doubling delay, saturation detection for log-level escalation, …).
 *
 * Typical usage:
 *
 * ```ts
 * const backoff = new ExponentialBackoff();
 * while (running) {
 *   try {
 *     await operation();
 *     backoff.reset();
 *   } catch (error) {
 *     const delay = backoff.recordFailure();
 *     logger[backoff.isSaturated ? 'error' : 'warn'](`retry in ${delay}ms`);
 *     await sleep(delay);
 *   }
 * }
 * ```
 */
export class ExponentialBackoff {
  private _failureCount = 0;
  readonly options: Required<ExponentialBackoffOptions>;

  constructor(options: ExponentialBackoffOptions = {}) {
    this.options = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
  }

  /** Number of consecutive failures recorded since the last reset. */
  get failureCount(): number {
    return this._failureCount;
  }

  /**
   * Record a failure and return the delay (ms) the caller should wait
   * before the next retry attempt.
   */
  recordFailure(): number {
    this._failureCount += 1;
    return this.currentDelay;
  }

  /** Reset the failure counter, e.g. after a successful operation. */
  reset(): void {
    this._failureCount = 0;
  }

  /** Delay (ms) corresponding to the most recently recorded failure. */
  get currentDelay(): number {
    if (this._failureCount === 0) {
      return 0;
    }
    return exponentialBackoffDelay(this._failureCount - 1, this.options);
  }

  /** True once the backoff has reached its `maxMs` cap. */
  get isSaturated(): boolean {
    return this.currentDelay >= this.options.maxMs;
  }

  /**
   * True only on the failure that first pushed the backoff to its cap.
   * Useful for emitting a single escalated log line when an outage transitions
   * from "ramping up" to "sustained".
   */
  get justSaturated(): boolean {
    if (!this.isSaturated) {
      return false;
    }
    if (this._failureCount <= 1) {
      return true;
    }
    const previous = exponentialBackoffDelay(
      this._failureCount - 2,
      this.options,
    );
    return previous < this.options.maxMs;
  }
}
