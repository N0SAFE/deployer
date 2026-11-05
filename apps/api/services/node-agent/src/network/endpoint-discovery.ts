import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { lookup } from 'node:dns/promises'

import { overlayEndpoint } from './overlay'
import {
    STUN_TRANSACTION_ID_LENGTH,
    decodeBindingResponse,
    encodeBindingRequest,
} from './stun'

/**
 * Where this node advertises that its WireGuard listener answers.
 *
 * The advertised websocket URL is only one source, and it is the operator's word, not a discovery: a node that
 * advertises nothing, or names only a host peers cannot reach, still needs a usable endpoint. So four sources, in the
 * order that trusts the operator most and the network least:
 *
 *   advertised  the host in the websocket URL the agent serves (explicit deployment configuration)
 *   declared    addresses the operator says are reachable (`MESH_DECLARED_ADDRESSES`)
 *   lan         this host's own interface addresses, minus Docker's, loopback and the mesh itself
 *   reflexive   the NAT's public address, from a STUN server — an assumption on the port, so it comes last
 *
 * Every candidate carries the WireGuard LISTEN port: a LAN or declared address offers no port of its own, and a
 * port-preserving NAT keeps the reflexive one (a symmetric NAT does not, which is why it is the last resort).
 */

const DECLARED_SPLIT = /,/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** The declared addresses in `raw`, comma separated, IPv4 only: a typo must not become an endpoint peers dial. */
export function declaredAddresses(raw: string): readonly string[] {
    const found: string[] = []
    for (const entry of raw.split(DECLARED_SPLIT)) {
        const address = entry.trim()
        const match = IPV4.exec(address)
        if (match === null) continue
        if (match.slice(1).some((octet) => Number(octet) > 255)) continue
        found.push(address)
    }
    return found
}

/** `host:port`, bracketing an IPv6 literal (the form a WireGuard endpoint needs). */
function endpointFor(host: string, listenPort: number): string {
    const bracketed =
        host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return `${bracketed}:${String(listenPort)}`
}

/** The endpoint this node advertises, from the first source that has one. Null when no source does. */
export function chooseEndpoint(input: {
    readonly advertisedUrl: string | undefined
    readonly declared: readonly string[]
    readonly lan: readonly string[]
    readonly reflexive: string | null
    readonly listenPort: number
}): string | null {
    if (input.advertisedUrl !== undefined) {
        const advertised = overlayEndpoint(
            input.advertisedUrl,
            input.listenPort
        )
        if (advertised !== null) return advertised
    }
    for (const address of input.declared) {
        if (address.length > 0) return endpointFor(address, input.listenPort)
    }
    for (const address of input.lan) {
        if (address.length > 0) return endpointFor(address, input.listenPort)
    }
    if (input.reflexive !== null && input.reflexive.length > 0)
        return endpointFor(input.reflexive, input.listenPort)
    return null
}

/** Whether a datagram came from the STUN server that was asked, and not from anything else on the network. */
export function isAskedServer(
    asked: { readonly address: string; readonly port: number },
    source: { readonly address: string; readonly port: number }
): boolean {
    return source.port === asked.port && source.address === asked.address
}

/**
 * Ask one STUN server for this host's public IPv4 address.
 *
 * Resolves null on timeout or a malformed answer: reflexive discovery is best-effort, and a LAN-only swarm never
 * needs it.
 *
 * The host is resolved BEFORE the request is sent, and a response is accepted only from that address and port: while
 * the socket waits, anything on the network can send it a datagram, and a binding response from an unknown sender would
 * have this node advertise an address the attacker chose.
 */
export function stunReflexiveAddress(
    server: string,
    timeoutMs = 3_000
): Promise<string | null> {
    const separator = server.lastIndexOf(':')
    const host = separator > 0 ? server.slice(0, separator) : server
    const port = separator > 0 ? Number(server.slice(separator + 1)) : 3478
    const transactionId = randomBytes(STUN_TRANSACTION_ID_LENGTH)

    return new Promise((resolve) => {
        const socket = createSocket('udp4')
        // The peer asked, once the name is resolved: null until then, so nothing is accepted before the question is sent.
        let asked: { readonly address: string; readonly port: number } | null =
            null
        let done = false
        const finish = (value: string | null) => {
            // A timeout, a socket error and a resolved name can all arrive; only the first one answers.
            if (done) return
            done = true
            clearTimeout(timer)
            socket.close()
            resolve(value)
        }
        const timer = setTimeout(() => {
            finish(null)
        }, timeoutMs)
        socket.on('error', () => {
            finish(null)
        })
        socket.on('message', (message, rinfo) => {
            if (asked === null || !isAskedServer(asked, rinfo)) return
            const mapped = decodeBindingResponse(message, transactionId)
            if (mapped !== null) finish(mapped.address)
        })
        lookup(host)
            .then(({ address }) => {
                asked = { address, port }
                socket.send(
                    encodeBindingRequest(transactionId),
                    port,
                    address,
                    (error) => {
                        if (error) finish(null)
                    }
                )
            })
            .catch(() => {
                finish(null)
            })
    })
}

/** Every server is asked at once and the first answer wins, so a dead server costs one timeout, not one per server. */
export async function discoverReflexiveAddress(
    servers: readonly string[],
    timeoutMs = 3_000
): Promise<string | null> {
    const answered = await Promise.all(
        servers.map((server) => stunReflexiveAddress(server, timeoutMs))
    )
    return answered.find((address) => address !== null) ?? null
}
