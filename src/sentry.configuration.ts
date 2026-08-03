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

    beforeSend: (event, hint) => {
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

      return event;
    },
  });
}
