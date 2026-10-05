import { Logger } from '@nestjs/common';
import { Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { ClientDisconnectedError } from './client-disconnected.error';
import { JsonArrayFilterTransform, jsonTokenParser } from './json-array-filter';

const logger = new Logger('StreamFilteredJsonArray');

/**
 * Incrementally parse the CouchDB response stream, filter/transform the
 * items of `arrayField` and forward the re-serialized JSON to the client.
 *
 * Errors that occur *before* the first byte was sent result in a regular
 * error response. Errors after that abort the connection so the client
 * sees a truncated response (and e.g. PouchDB retries) instead of
 * mistaking a partial payload for a complete one.
 */
export async function streamFilteredJsonArray(
  source: Readable,
  arrayField: string,
  mapItem: (item: any) => unknown,
  res: Response,
): Promise<void> {
  res.status(200);
  res.setHeader('content-type', 'application/json');
  const filtered = new JsonArrayFilterTransform({ arrayField, mapItem });
  // `res` is deliberately not part of the pipeline: stream.pipeline destroys
  // every stream it is given on error, which would tear down the response
  // socket even for a failure on the very first token and leave no way to
  // send a status.
  const parsing = pipeline(source, jsonTokenParser(), filtered);
  try {
    await Promise.all([parsing, forwardToResponse(filtered, res)]);
  } catch (error) {
    if (!res.headersSent && !res.writableEnded && !res.destroyed) {
      throw error;
    }
    logAbortedStream(error, res);
    res.destroy();
  }
}

/**
 * Report a stream that was abandoned after the response had already started.
 *
 * A client that goes away mid-stream is ordinary behaviour rather than a
 * fault of this service, so it stays at debug level and out of Sentry (see
 * {@link SentryLogger}, which forwards only `warn` and `error`). Anything
 * else is a genuine problem and is reported with a constant message, with
 * the variable detail attached as structured context so Sentry groups all
 * occurrences into one issue instead of one issue per error text.
 *
 * A destroyed response counts as a disconnect even when the error came from
 * somewhere else: the CouchDB source and the response socket race here, and
 * when the client goes away the source often errors ("aborted") before the
 * response's `close` handler can raise a {@link ClientDisconnectedError}.
 * Which of the two wins says nothing about the cause, so it must not decide
 * whether this is reported as a fault.
 */
function logAbortedStream(error: unknown, res: Response): void {
  if (error instanceof ClientDisconnectedError || res.destroyed) {
    logger.debug('aborting streamed response: client disconnected');
    return;
  }

  logger.warn('aborting streamed response after stream error', {
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Forward the filtered JSON to the client, keeping backpressure but leaving
 * the response itself untouched on error, so an early failure can still be
 * turned into a regular error response by the caller.
 */
function forwardToResponse(source: Readable, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      source.off('error', onError);
      res.off('error', onError);
      res.off('finish', onFinish);
      res.off('close', onClose);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onFinish = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      if (res.writableFinished) {
        resolve();
        return;
      }
      // client gone: release the CouchDB response instead of reading it to the end
      source.destroy();
      reject(new ClientDisconnectedError());
    };
    source.once('error', onError);
    res.once('error', onError);
    res.once('finish', onFinish);
    res.once('close', onClose);
    source.pipe(res);
  });
}
