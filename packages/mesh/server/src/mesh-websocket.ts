import { RPCHandler } from "@orpc/server/websocket";
import { WebSocketServer } from "ws";

import type { Context, Router } from "@orpc/server";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";


export type MeshWebSocketOptions<T extends Context> = {
  /** The http server the service already runs: the websocket shares its port. */
  readonly server: Server;
  /** The upgrade path, e.g. `/mesh/ws`. Any other path is left to whoever else listens for upgrades. */
  readonly path: string;
  readonly router: Router<T>;
  /**
   * `true` when what the peer presented proves it is part of the mesh. May ask someone else (a service asks its local
   * agent, which holds the credential), so it can be async. A verifier that throws refuses the peer.
   */
  readonly verify: (credential: string | undefined) => boolean | Promise<boolean>;
  /**
   * The oRPC context of one call. Read per call, not per connection: a connection lives for hours, the context (the
   * Effect runtime's services) must be the one of the moment, and the headers of the call are the caller's own.
   */
  readonly context: (upgrade: IncomingMessage, call: MeshCall) => T | Promise<T>;
  /** How often a silent connection is pinged. A peer that misses one round is dropped. */
  readonly keepAliveMs?: number;
};

/** What one call carries: the headers its caller attached, which is where the caller's credentials travel. */
export type MeshCall = { readonly headers: Readonly<Record<string, string | string[] | undefined>> };

export type MeshWebSocket = {
  readonly close: () => Promise<void>;
  /** Connections currently open. */
  readonly size: () => number;
};

const CREDENTIAL_PARAM = "credential";

function refuse(socket: Duplex, status: string): void {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Serves an oRPC router over a persistent websocket, on an http server that already exists.
 *
 * The mesh credential is checked at the upgrade, before a connection exists, so an unauthenticated peer costs one
 * refused request and never holds a socket. After that the connection is the oRPC RPC protocol: calls, streams and event
 * iterators share it, which is what makes the link persistent instead of one connection per request.
 */
export function attachMeshWebSocket<T extends Context>(options: MeshWebSocketOptions<T>): MeshWebSocket {
  const handler = new RPCHandler<T>(options.router);
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakSet();

  const isTrusted = async (credential: string | undefined): Promise<boolean> => {
    try {
      return await options.verify(credential);
    } catch {
      return false;
    }
  };

  const onUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://mesh");
    if (url.pathname !== options.path) {
      // Nobody else listening for upgrades means nobody will answer: refuse instead of leaving the socket open.
      if (options.server.listenerCount("upgrade") <= 1) {
        refuse(socket, "404 Not Found");
      }
      return;
    }
    if (!(await isTrusted(url.searchParams.get(CREDENTIAL_PARAM) ?? undefined))) {
      refuse(socket, "401 Unauthorized");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.binaryType = "arraybuffer";
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      handler.upgrade(ws, { context: (call) => options.context(request, call) });
      wss.emit("connection", ws, request);
    });
  };
  const listener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void onUpgrade(request, socket, head);
  options.server.on("upgrade", listener);

  const keepAlive = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, options.keepAliveMs ?? 15_000);
  keepAlive.unref();

  return {
    size: () => wss.clients.size,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(keepAlive);
        options.server.off("upgrade", listener);
        for (const ws of wss.clients) {
          ws.terminate();
        }
        wss.close(() => { resolve(); });
      }),
  };
}
