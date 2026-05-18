import { HttpException } from '@nestjs/common';
import { inspect } from 'node:util';

const AUTH_HTTP_STATUSES = new Set([401, 403]);
const LIKELY_TRANSIENT_HTTP_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);
const LIKELY_TRANSIENT_ERROR_MARKERS = [
  'econnrefused',
  'econnreset',
  'etimedout',
  'socket hang up',
  'connection reset',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'temporarily unavailable',
];

export function isAuthHttpError(err: unknown): err is HttpException {
  return (
    err instanceof HttpException && AUTH_HTTP_STATUSES.has(err.getStatus())
  );
}

export function isLikelyTransientError(err: unknown): boolean {
  if (
    err instanceof HttpException &&
    LIKELY_TRANSIENT_HTTP_STATUSES.has(err.getStatus())
  ) {
    return true;
  }

  const normalizedError = normalizeErrorText(err);
  return LIKELY_TRANSIENT_ERROR_MARKERS.some((marker) =>
    normalizedError.includes(marker),
  );
}

function normalizeErrorText(err: unknown): string {
  if (err instanceof HttpException) {
    const response = err.getResponse();
    let detail: string;

    if (typeof response === 'string') {
      detail = response;
    } else {
      try {
        detail = JSON.stringify(response);
      } catch {
        detail = inspect(response, { depth: null });
      }
    }

    return `HttpException ${err.getStatus()}: ${detail}`.toLowerCase();
  }

  if (err instanceof Error) {
    return (err.stack ?? err.message).toLowerCase();
  }

  return String(err).toLowerCase();
}
