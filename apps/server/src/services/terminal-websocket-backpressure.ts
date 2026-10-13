const DEFAULT_MAX_TERMINAL_WEBSOCKET_BUFFERED_BYTES = 8 * 1024 * 1024;
const TERMINAL_WEBSOCKET_BACKPRESSURE_CLOSE_CODE = 1013;
const TERMINAL_WEBSOCKET_BACKPRESSURE_REASON = "terminal output backpressure";

export interface TerminalWebSocketLike {
  bufferedAmount: number;
  readyState?: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export type BoundedTerminalWebSocketSender = ((frame: string) => void) & {
  isClosed: () => boolean;
};

const WEBSOCKET_OPEN_READY_STATE = 1;

export function createBoundedTerminalWebSocketSender(
  socket: TerminalWebSocketLike,
  options: { maxBufferedBytes?: number } = {},
): BoundedTerminalWebSocketSender {
  const maxBufferedBytes =
    options.maxBufferedBytes ?? DEFAULT_MAX_TERMINAL_WEBSOCKET_BUFFERED_BYTES;

  let closed = false;

  const send: BoundedTerminalWebSocketSender = ((frame: string) => {
    if (closed) {
      return;
    }

    if (
      socket.readyState !== undefined &&
      socket.readyState !== WEBSOCKET_OPEN_READY_STATE
    ) {
      closed = true;
      return;
    }

    const nextBufferedBytes = socket.bufferedAmount + Buffer.byteLength(frame);
    if (nextBufferedBytes > maxBufferedBytes) {
      closed = true;
      socket.close(
        TERMINAL_WEBSOCKET_BACKPRESSURE_CLOSE_CODE,
        TERMINAL_WEBSOCKET_BACKPRESSURE_REASON,
      );
      return;
    }

    socket.send(frame);
  }) as BoundedTerminalWebSocketSender;

  send.isClosed = () => closed;

  return send;
}
