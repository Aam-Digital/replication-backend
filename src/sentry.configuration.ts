import * as Sentry from '@sentry/node';
import { ConfigService } from '@nestjs/config';
import {
  ArgumentsHost,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';

export class SentryConfiguration {
  ENABLED: boolean = false;
  DSN = '';
  INSTANCE_NAME = '';
  ENVIRONMENT = '';
}

function loadSentryConfiguration(
  configService: ConfigService,
): SentryConfiguration {
  return {
    ENABLED: configService.getOrThrow('SENTRY_ENABLED'),
    DSN: configService.getOrThrow('SENTRY_DSN'),
    INSTANCE_NAME: configService.getOrThrow('SENTRY_INSTANCE_NAME'),
    ENVIRONMENT: configService.getOrThrow('SENTRY_ENVIRONMENT'),
  };
}

export function configureSentry(
  app: INestApplication,
  configService: ConfigService,
): void {
  const sentryConfiguration = loadSentryConfiguration(configService);
  if (sentryConfiguration.ENABLED) {
    configureLoggingSentry(app, sentryConfiguration);
  }
}

export class SentryFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    Sentry.captureException(exception);
    super.catch(exception, host);
  }
}

function configureLoggingSentry(
  app: INestApplication,
  sentryConfiguration: SentryConfiguration,
): void {
  Sentry.init({
    debug: true,
    serverName: sentryConfiguration.INSTANCE_NAME,
    environment: sentryConfiguration.ENVIRONMENT,
    dsn: sentryConfiguration.DSN,
    integrations: [
      // enable HTTP calls tracing
      new Sentry.Integrations.Console(),
      new Sentry.Integrations.Http({ tracing: true }),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, //  Capture 100% of the transactions
    // Set sampling rate for profiling - this is relative to tracesSampleRate
    profilesSampleRate: 1.0,

    beforeSend: (event, hint) => {
      const error = hint.originalException;
      if (error instanceof UnauthorizedException) {
        console.log(error);
        return null;
      }

      return event;
    },
  });

  app.use(Sentry.Handlers.errorHandler());
  app.use(Sentry.Handlers.tracingHandler());
  app.use(Sentry.Handlers.requestHandler());

  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryFilter(httpAdapter));
}
