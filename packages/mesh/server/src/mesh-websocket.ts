import { RPCHandler } from '@orpc/server/websocket'
import { WebSocketServer, type RawData } from 'ws'

import type { Context, Router } from '@orpc/server'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

export type MeshWebSocketOptions<T extends Context> = {
    /** The http server the service already runs: the websocket shares its port. */
    readonly server: Server
    /** The upgrade path, e.g. `/mesh/ws`. Any other path is left to whoever else listens for upgrades. */
    readonly path: string
    readonly router: Router<T>
    /**
     * `true` when what the peer presented proves it is part of the mesh. May ask someone else (a service asks its local
     * agent, which holds the credential), so it can be async. A verifier that throws refuses the peer.
     */
    readonly verify: (
        credential: string | undefined
    ) => boolean | Promise<boolean>
    /**
     * The oRPC context of one call. Read per call, not per connection: a connection lives for hours, the context (the
     * Effect runtime's services) must be the one of the moment, and the headers of the call are the caller's own.
     */
    readonly context: (
        upgrade: IncomingMessage,
        call: MeshCall
    ) => T | Promise<T>
    /** How often a silent connection is pinged. A peer that misses one round is dropped. */
    readonly keepAliveMs?: number
    /**
     * Bytes carried by the socket, both directions: the agent's lease policy is fed from here rather than by parsing
     * payloads. Measured on this server's side only, which is what "how hard is this agent working" means.
     */
    readonly onBytes?: (bytes: number) => void
    /**
     * Connections one peer at a time: a peer that opens a thousand costs one refused upgrade each, never a socket. The
     * default is far above a swarm's size and far below a file-descriptor limit.
     */
    readonly maxConnections?: number
}

/** 1 MiB: the largest legitimate frame is a relayed payload, and a peer must not make this process buffer more. */
export const MAX_FRAME_BYTES = 1_048_576
const DEFAULT_MAX_CONNECTIONS = 512

/** What one call carries: the headers its caller attached, which is where the caller's credentials travel. */
export type MeshCall = {
    readonly headers: Readonly<Record<string, string | string[] | undefined>>
}

export type MeshWebSocket = {
    readonly close: () => Promise<void>
    /** Connections currently open. */
    readonly size: () => number
}

const CREDENTIAL_PARAM = 'credential'

/** Size of a frame as it arrives or leaves, whatever buffer type `ws` hands over. */
function byteLength(data: RawData): number {
    if (typeof data === 'string') return Buffer.byteLength(data)
    if (data instanceof ArrayBuffer) return data.byteLength
    if (Array.isArray(data))
        return data.reduce((total, chunk) => total + chunk.byteLength, 0)
    return data.byteLength
}

function refuse(socket: Duplex, status: string): void {
    socket.write(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    )
    socket.destroy()
}

/**
 * Serves an oRPC router over a persistent websocket, on an http server that already exists.
 *
 * The mesh credential is checked at the upgrade, before a connection exists, so an unauthenticated peer costs one
 * refused request and never holds a socket. After that the connection is the oRPC RPC protocol: calls, streams and event
 * iterators share it, which is what makes the link persistent instead of one connection per request.
 */
export function attachMeshWebSocket<T extends Context>(
    options: MeshWebSocketOptions<T>
): MeshWebSocket {
    const handler = new RPCHandler<T>(options.router)
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_FRAME_BYTES,
    })
    const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
    const alive = new WeakSet()

    const isTrusted = async (
        credential: string | undefined
    ): Promise<boolean> => {
        try {
            return await options.verify(credential)
        } catch {
            return false
        }
    }

    const onUpgrade = async (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer
    ) => {
        const url = new URL(request.url ?? '/', 'http://mesh')
        if (url.pathname !== options.path) {
            // Nobody else listening for upgrades means nobody will answer: refuse instead of leaving the socket open.
            if (options.server.listenerCount('upgrade') <= 1) {
                refuse(socket, '404 Not Found')
            }
            return
        }
        if (
            !(await isTrusted(
                url.searchParams.get(CREDENTIAL_PARAM) ?? undefined
            ))
        ) {
            refuse(socket, '401 Unauthorized')
            return
        }
        // Authenticated, but the peer already holds all it may: the credential is not a licence to exhaust this process.
        if (wss.clients.size >= maxConnections) {
            refuse(socket, '503 Service Unavailable')
            return
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
            ws.binaryType = 'arraybuffer'
            alive.add(ws)
            ws.on('pong', () => alive.add(ws))
            if (options.onBytes !== undefined) {
                const count = options.onBytes
                ws.on('message', (data: RawData) => {
                    count(byteLength(data))
                })
                const send = ws.send.bind(ws) as (...args: unknown[]) => unknown
                ws.send = ((data: RawData, ...rest: unknown[]) => {
                    count(byteLength(data))
                    return send(data, ...rest)
                }) as typeof ws.send
            }
            handler.upgrade(ws, {
                context: (call) => options.context(request, call),
            })
            wss.emit('connection', ws, request)
        })
    }
    const listener = (request: IncomingMessage, socket: Duplex, head: Buffer) =>
        void onUpgrade(request, socket, head)
    options.server.on('upgrade', listener)

    const keepAlive = setInterval(() => {
        for (const ws of wss.clients) {
            if (!alive.has(ws)) {
                ws.terminate()
                continue
            }
            alive.delete(ws)
            ws.ping()
        }
    }, options.keepAliveMs ?? 15_000)
    keepAlive.unref()

    return {
        size: () => wss.clients.size,
        close: () =>
            new Promise<void>((resolve) => {
                clearInterval(keepAlive)
                options.server.off('upgrade', listener)
                for (const ws of wss.clients) {
                    ws.terminate()
                }
                wss.close(() => {
                    resolve()
                })
            }),
    }
}
