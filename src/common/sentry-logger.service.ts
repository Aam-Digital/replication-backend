import { ConsoleLogger, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';

/**
 * NestJS logger that mirrors `error` and `warn` messages to Sentry,
 * in addition to printing them via the default {@link ConsoleLogger}.
 *
 * NestJS's built-in `Logger` writes directly to stdout/stderr and bypasses
 * the global `console`, so Sentry's `captureConsoleIntegration` does not
 * pick these messages up. This class closes that gap by explicitly
 * forwarding them through the Sentry SDK.
 *
 * If Sentry has not been initialized the capture calls are no-ops,
 * so this logger is safe to use when Sentry is disabled.
 */
@Injectable()
export class SentryLogger extends ConsoleLogger {
  error(message: any, ...optionalParams: any[]): void {
    super.error(message, ...optionalParams);
    this.captureToSentry('error', message, optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    super.warn(message, ...optionalParams);
    this.captureToSentry('warning', message, optionalParams);
  }

  private captureToSentry(
    level: 'error' | 'warning',
    message: any,
    optionalParams: any[],
  ): void {
    // If an Error was passed (as the message or any extra param), capture
    // it as an exception so Sentry shows the proper stack trace.
    // Otherwise just send the message text.
    const error = [message, ...optionalParams].find((p) => p instanceof Error);
    if (error) {
      Sentry.captureException(error, { level });
    } else {
      Sentry.captureMessage(String(message), level);
    }
  }
}
