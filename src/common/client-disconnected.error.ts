/**
 * Signals that the client closed the connection before the response was
 * finished, so the remaining work was abandoned.
 *
 * This is ordinary client behaviour — navigating away, backgrounding a tab, a
 * mobile network dropping — and not a fault of this service. It is a dedicated
 * type rather than a plain `Error` so the handling code can recognise it
 * without matching on message text.
 */
export class ClientDisconnectedError extends Error {
  constructor() {
    super('client disconnected');
    this.name = 'ClientDisconnectedError';
  }
}
