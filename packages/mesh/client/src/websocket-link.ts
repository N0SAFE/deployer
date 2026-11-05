import { RPCLink } from '@orpc/client/websocket'
import { WebSocket as NodeWebSocket } from 'ws'

import type { PooledConnection } from './pooled-link'
import type { ClientContext } from '@orpc/client'

export type WebSocketConnectionOptions = {
    /** The websocket to open. With `socketPath`, only its path and query are used; the host is the socket. */
    readonly url: string
    /**
     * Connect through a unix domain socket instead of the network. The socket's file permissions are the trust boundary,
     * which is how a service on the same node reaches its agent without ever holding the swarm's credential.
     */
    readonly socketPath?: string
    /** Reconnect delay in ms. A connection that cannot come back is evicted by the pool and replaced. */
    readonly reconnectDelayMs?: number
    /** Consecutive failed attempts before waiting calls fail. */
    readonly maxAttempts?: number
}

/**
 * One persistent connection: an oRPC RPC link over a websocket, not the OpenAPI link, so calls, streams and event
 * iterators share a single long-lived connection instead of paying a setup per request.
 */
/** `ws` is the one client that can dial a unix socket, under Node and under Bun alike; it speaks the same events. */
function openOverSocket(socketPath: string, url: string): WebSocket {
    const target = new URL(url)
    return new NodeWebSocket(
        `ws+unix://${socketPath}:${target.pathname}${target.search}`
    ) as unknown as WebSocket
}

export function openWebSocketConnection<C extends ClientContext>(
    options: WebSocketConnectionOptions
): PooledConnection<C> {
    let socket: WebSocket | undefined
    // Resolves once the socket is open and rejects when the handshake fails. A refused handshake (a wrong credential, a
    // replica that is gone) reports an `error` and, in some runtimes, never a `close`; the transport counts attempts on
    // a failed `connect`, so rejecting here is what makes a refusal a failed attempt instead of a call that waits forever.
    const connect = () =>
        new Promise<WebSocket>((resolve, reject) => {
            const next =
                options.socketPath === undefined
                    ? new WebSocket(options.url)
                    : openOverSocket(options.socketPath, options.url)
            next.addEventListener(
                'open',
                () => {
                    socket = next
                    resolve(next)
                },
                { once: true }
            )
            next.addEventListener(
                'error',
                () => {
                    reject(
                        new Error(
                            `Could not connect to ${new URL(options.url).host}`
                        )
                    )
                },
                { once: true }
            )
        })

    const link = new RPCLink<C>({
        // The caller's credentials for one call travel in its client context, so one pooled connection serves every caller.
        headers: ({ context }) =>
            (context as { headers?: Record<string, string> }).headers ?? {},
        connect,
        // A bounded number of attempts: a peer that refuses the connection (a wrong credential, a replica that is gone) fails
        // the calls waiting on it instead of holding them forever. The pool then opens a fresh connection for the next call.
        reconnect: {
            enabled: true,
            maxAttempt: options.maxAttempts ?? 3,
            delay: ({ attempt }) =>
                attempt === 1 ? 0 : (options.reconnectDelayMs ?? 2_000),
        },
    })

    return {
        link,
        close: () => {
            socket?.close()
            return Promise.resolve()
        },
        healthy: () =>
            socket === undefined ||
            socket.readyState === WebSocket.CONNECTING ||
            socket.readyState === WebSocket.OPEN,
    }
}
