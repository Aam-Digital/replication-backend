import { Response } from 'express';

/**
 * Streams a JSON response whose primary payload is one incrementally-written
 * array field. The response envelope is opened lazily — only after the first
 * successful upstream batch — so that errors raised before any data is ready
 * still produce a proper HTTP error status instead of a truncated stream.
 *
 * Subclasses provide the array-field name via the constructor and expose
 * domain-specific `write*` / `finish` methods that delegate to
 * {@link writeItems} and {@link closeWith}.
 */
export abstract class JsonArrayResponseStream {
  protected written = 0;
  private opened = false;

  protected constructor(
    private readonly res: Response,
    private readonly openingChunk: string,
  ) {}

  /** Whether the client has disconnected. */
  get isClosed(): boolean {
    return this.res.destroyed;
  }

  /** Number of docs written to the response so far. */
  get docsWritten(): number {
    return this.written;
  }

  /**
   * Serialize and stream one batch of items into the array, opening the
   * envelope on the first call. Flushes after each batch so compression
   * middleware does not buffer the data until the response ends.
   */
  protected async writeItems<T>(
    items: T[],
    serialize: (item: T) => unknown,
  ): Promise<void> {
    await this.open();
    for (const item of items) {
      await this.writeChunk(
        (this.written > 0 ? ',' : '') + JSON.stringify(serialize(item)),
      );
      this.written++;
    }
    this.flush();
  }

  /**
   * Close the array, append the envelope tail and end the response.
   * Ensures the envelope is opened even when no items were written.
   */
  protected async closeWith(closingChunk: string): Promise<void> {
    await this.open();
    await this.writeChunk(closingChunk);
    this.res.end();
  }

  /**
   * Send the response headers and open the JSON envelope (idempotent).
   *
   * Deliberately called only after the first upstream batch succeeds, so that
   * upstream errors (e.g. unknown db) still yield a proper error status instead
   * of a truncated stream.
   */
  private async open(): Promise<void> {
    if (this.opened) return;
    this.opened = true;
    this.res.status(200);
    this.res.setHeader('content-type', 'application/json');
    await this.writeChunk(this.openingChunk);
  }

  /**
   * Hand the buffered bytes to the client right away.
   *
   * Without this the compression middleware keeps a batch in its gzip buffer
   * until enough data has accumulated, so nothing reaches the client until the
   * response ends and the incremental writing above has no effect for the
   * (compressing) clients that actually sync.
   */
  private flush(): void {
    (this.res as Response & { flush?: () => void }).flush?.();
  }

  /**
   * Write a chunk to the response, awaiting the drain event when the
   * client cannot keep up (backpressure).
   */
  private writeChunk(chunk: string): Promise<void> {
    const res = this.res;
    return new Promise((resolve, reject) => {
      if (res.destroyed) {
        reject(new Error('client disconnected'));
        return;
      }
      if (res.write(chunk)) {
        resolve();
        return;
      }
      const cleanup = () => {
        res.off('drain', onDrain);
        res.off('close', onFailure);
        res.off('error', onFailure);
      };
      const onDrain = () => {
        cleanup();
        resolve();
      };
      // socket error or close while back-pressured: settle the promise so the
      // request handler never hangs (which would leak a CouchDB keep-alive
      // socket). 'error' is required — without it a socket error that does not
      // also emit 'close' would leave this promise pending forever.
      const onFailure = () => {
        cleanup();
        reject(new Error('client disconnected'));
      };
      res.once('drain', onDrain);
      res.once('close', onFailure);
      res.once('error', onFailure);
    });
  }
}
