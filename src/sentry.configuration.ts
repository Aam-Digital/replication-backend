import { ArgumentsHost, INestApplication, Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common/exceptions/http.exception';
import { ConfigService } from '@nestjs/config';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import * as Sentry from '@sentry/node';

const logger = new Logger('Sentry');

interface SentryConfiguration {
  ENABLED: boolean;
  DSN: string;
  INSTANCE_NAME: string;
  ENVIRONMENT: string;
}

function loadSentryConfiguration(
  configService: ConfigService,
): SentryConfiguration {
  return {
    ENABLED: parseBoolean(configService.get('SENTRY_ENABLED')),
    DSN: configService.get('SENTRY_DSN', ''),
    INSTANCE_NAME: configService.get('SENTRY_INSTANCE_NAME', ''),
    ENVIRONMENT: configService.get('SENTRY_ENVIRONMENT', ''),
  };
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return false;
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
    `Sentry initialized (environment="${sentryConfiguration.ENVIRONMENT}", instance="${sentryConfiguration.INSTANCE_NAME}").`,
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

function initSentrySdk(sentryConfiguration: SentryConfiguration): void {
  Sentry.init({
    serverName: sentryConfiguration.INSTANCE_NAME,
    environment: sentryConfiguration.ENVIRONMENT,
    dsn: sentryConfiguration.DSN,
    integrations: [
      // enable HTTP calls tracing
      Sentry.captureConsoleIntegration(),
      Sentry.httpIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
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

      return event;
    },
  });
}
