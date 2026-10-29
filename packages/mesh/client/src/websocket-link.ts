import { RPCLink } from "@orpc/client/websocket";

import type { PooledConnection } from "./pooled-link";
import type { ClientContext } from "@orpc/client";

export type WebSocketConnectionOptions = {
  readonly url: string;
  /** Reconnect delay in ms. A connection that cannot come back is evicted by the pool and replaced. */
  readonly reconnectDelayMs?: number;
};

/**
 * One persistent connection: an oRPC RPC link over a websocket, not the OpenAPI link, so calls, streams and event
 * iterators share a single long-lived connection instead of paying a setup per request.
 */
export function openWebSocketConnection<C extends ClientContext>(options: WebSocketConnectionOptions): PooledConnection<C> {
  let socket: WebSocket | undefined;
  const connect = () => {
    socket = new WebSocket(options.url);
    return socket;
  };

  const link = new RPCLink<C>({
    connect,
    reconnect: { enabled: true, delay: ({ attempt }) => (attempt === 1 ? 0 : (options.reconnectDelayMs ?? 2_000)) },
  });

  return {
    link,
    close: () => {
      socket?.close();
      return Promise.resolve();
    },
    healthy: () => socket === undefined || socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN,
  };
}
