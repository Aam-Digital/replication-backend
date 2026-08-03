import { ArgumentsHost, INestApplication, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { version } from '../package.json';

const logger = new Logger('Sentry');

interface SentryConfiguration {
  ENABLED: boolean;
  DSN: string;
  INSTANCE_NAME: string;
  ENVIRONMENT: string;
  TRACES_SAMPLE_RATE: number;
}

const DEFAULT_TRACES_SAMPLE_RATE = 0.02;

function parseSampleRate(
  value: unknown,
  envName: string,
  fallback: number,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    logger.warn(
      `Invalid ${envName} value "${String(value)}". Falling back to ${fallback}. Expected a number between 0.0 and 1.0.`,
    );
    return fallback;
  }

  return parsed;
}

function loadSentryConfiguration(
  configService: ConfigService,
): SentryConfiguration {
  const tracesSampleRate = parseSampleRate(
    configService.get('SENTRY_TRACES_SAMPLE_RATE', DEFAULT_TRACES_SAMPLE_RATE),
    'SENTRY_TRACES_SAMPLE_RATE',
    DEFAULT_TRACES_SAMPLE_RATE,
  );

  return {
    ENABLED: configService.get<boolean>('SENTRY_ENABLED', false),
    DSN: configService.get('SENTRY_DSN', ''),
    INSTANCE_NAME: configService.get('SENTRY_INSTANCE_NAME', ''),
    ENVIRONMENT: configService.get('SENTRY_ENVIRONMENT', ''),
    TRACES_SAMPLE_RATE: tracesSampleRate,
  };
}

/**
 * Initialize the Sentry SDK. Safe to call before the Nest application
 * is created so that early bootstrap logs can already be captured.
 *
 * Returns `true` if Sentry was initialized, `false` if it is disabled.
 */
export function initSentry(configService: ConfigService): boolean {
  const sentryConfiguration = loadSentryConfiguration(configService);
  if (!sentryConfiguration.ENABLED) {
    logger.log('Sentry is disabled (SENTRY_ENABLED is not "true").');
    return false;
  }
  if (!sentryConfiguration.DSN) {
    logger.warn(
      'Sentry is enabled but SENTRY_DSN is empty — skipping Sentry initialization.',
    );
    return false;
  }
  try {
    initSentrySdk(sentryConfiguration);
  } catch (err) {
    logger.error(
      `Failed to initialize Sentry: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err.stack : undefined,
    );
    return false;
  }

  // `Sentry.init` does not throw on an invalid DSN — it logs internally
  // and ends up with a no-op client. Verify the DSN was actually parsed.
  if (!Sentry.getClient()?.getDsn()) {
    logger.error(
      `Sentry initialization failed: SENTRY_DSN was rejected as invalid.`,
    );
    return false;
  }

  logger.log(
    `Sentry initialized (environment="${sentryConfiguration.ENVIRONMENT}", instance="${sentryConfiguration.INSTANCE_NAME}", tracesSampleRate=${sentryConfiguration.TRACES_SAMPLE_RATE}).`,
  );
  return true;
}

/**
 * Bind Sentry into the Nest application's HTTP error pipeline.
 * Must be called after {@link initSentry} and after the Nest app exists.
 */
export function configureSentry(app: INestApplication): void {
  if (!Sentry.isInitialized()) {
    return;
  }
  app.use(Sentry.expressErrorHandler());

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryFilter(httpAdapter));
}

class SentryFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    Sentry.captureException(exception);
    super.catch(exception, host);
  }
}

/**
 * Data that varies between occurrences of the same log message and therefore
 * has to be masked before the message can be used as a grouping key.
 * Order matters: the more specific patterns have to run before the plain number.
 */
const VOLATILE_MESSAGE_PATTERNS: [RegExp, string][] = [
  [/https?:\/\/\S+/gi, '<url>'],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '<uuid>',
  ],
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>'],
  [/\d+/g, '<n>'],
];

/**
 * Build a stable grouping key for a log message.
 *
 * Callers are expected to keep message strings constant and pass variable
 * details as an object parameter (see {@link SentryLogger}), but a message that
 * still interpolates an id, host or counter must not fragment into one issue
 * per value - so those are masked here as a safety net.
 *
 * Note this replaces an earlier heuristic that used the message prefix up to
 * the first colon: it silently did nothing for messages without a colon (one
 * issue per user id), and split on variable data that appeared *before* the
 * colon (one issue per retry counter).
 */
export function normalizeLogMessage(message: string): string {
  return VOLATILE_MESSAGE_PATTERNS.reduce(
    (normalized, [pattern, placeholder]) =>
      normalized.replace(pattern, placeholder),
    message,
  );
}

function initSentrySdk(sentryConfiguration: SentryConfiguration): void {
  Sentry.init({
    release: version,
    serverName: sentryConfiguration.INSTANCE_NAME,
    environment: sentryConfiguration.ENVIRONMENT,
    dsn: sentryConfiguration.DSN,
    integrations: [
      // enable HTTP calls tracing
      Sentry.captureConsoleIntegration(),
      Sentry.httpIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: sentryConfiguration.TRACES_SAMPLE_RATE,
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,

    beforeSend,
  });
}

/**
 * Route for an event when none can be determined, kept as an explicit constant
 * so grouped events don't silently merge with events that do have a route.
 */
const UNKNOWN_ROUTE = '<unknown route>';

/**
 * Statuses that describe the upstream (CouchDB, or a gateway in front of it)
 * being unreachable or unhealthy, rather than describing the request that
 * happened to hit it.
 *
 * These are grouped by status alone, without a route. A generic "Bad Gateway"
 * means the same thing no matter which endpoint observed it, so including the
 * route would split a single CouchDB outage into as many issues as there are
 * endpoints in flight — exactly the fragmentation this fingerprinting exists to
 * prevent. Operation-specific failures (500 and anything else) do differ by
 * endpoint and keep their route.
 */
const UPSTREAM_AVAILABILITY_STATUSES: ReadonlySet<number> = new Set([
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Decide whether an event is reported, and how it is grouped.
 *
 * Exported for testing — the grouping rules here determine whether a Sentry
 * issue is actionable, so they are worth asserting on directly.
 */
export function beforeSend(
  event: Sentry.ErrorEvent,
  hint: Sentry.EventHint,
): Sentry.ErrorEvent | null {
  const error = hint.originalException;
  if (
    error instanceof HttpException &&
    error.getStatus() >= 400 &&
    error.getStatus() < 500
  ) {
    return null;
  }

  if (event.message) {
    event.fingerprint = [normalizeLogMessage(event.message)];
  }

  // CouchdbService maps every failed axios response to a bare `HttpException`
  // (see `initMapAxiosErrorsToNestjsExceptions`), whose message renders as the
  // constant string "Http Exception". Sentry groups on that, so without an
  // explicit fingerprint every CouchDB fault — any status, any route — merges
  // into one opaque issue with no status and no route in its title. Fingerprint
  // on status, and on route where the route is what distinguishes one fault
  // from another (see {@link UPSTREAM_AVAILABILITY_STATUSES}), so distinct
  // faults stay distinct and each group is diagnosable on its own.
  //
  // This affects grouping only; the `HttpException` propagated to the client is
  // untouched, so response bodies and status codes are unchanged.
  if (error instanceof HttpException) {
    const status = error.getStatus();

    // Purpose-built exceptions (BadGatewayException, InternalServerErrorException,
    // ...) are a different case from the bare, axios-mapped HttpException above:
    // their message is chosen by the call site to describe *why* it failed, e.g.
    // "Upstream identity provider is unavailable" (Keycloak) vs "Failed to load
    // target entity document" (CouchDB) — two dependencies that can both throw
    // BadGatewayException from the very same route. Status+route alone would
    // conflate them into one issue; the message is what actually tells them
    // apart, so prefer it here. Still normalize it: a call site may interpolate
    // an id into an otherwise-static message (see normalizeLogMessage above).
    event.fingerprint =
      error.constructor === HttpException
        ? UPSTREAM_AVAILABILITY_STATUSES.has(status)
          ? ['HttpException', String(status)]
          : [
              'HttpException',
              String(status),
              event.transaction ?? UNKNOWN_ROUTE,
            ]
        : ['HttpException', String(status), normalizeLogMessage(error.message)];
  }

  return event;
}
