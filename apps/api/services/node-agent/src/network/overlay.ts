import z from 'zod/v4'

/**
 * The overlay: the private address space the nodes reach each other on, and the rules that assign one address per node
 * without a coordinator.
 *
 * Every node derives its own address from its node id and a salt, gossips it, and moves to the next salt when a node
 * with a lower id already holds it. The rule is total and the same on every node, so the swarm converges without an
 * allocator and without a consensus round: at most one of two claimants moves, and it is always the one with the higher
 * id (the lower id keeps the address it already advertised).
 */

/** `10.88.0.0/16`: the address space of the overlay, of which hosts 1..65534 are usable. */
export const OVERLAY_PREFIX_LENGTH = 16
export const OVERLAY_NETWORK = '10.88'

/** The store name of the overlay identity this node advertises (JSON, see `OverlaySelf`). */
export const OVERLAY_SELF_SECRET = 'overlay.self'
/** The store name of the address salt this node last settled on. */
export const OVERLAY_SALT_SECRET = 'overlay.salt'
/** The store names of this node's WireGuard key pair. */
export const WIREGUARD_PRIVATE_KEY_SECRET = 'wireguard.private-key'
export const WIREGUARD_PUBLIC_KEY_SECRET = 'wireguard.public-key'

/** Below Ethernet by WireGuard's own overhead; the interface MTU every node uses. */
export const DEFAULT_WIREGUARD_PORT = 51820
/** NAT keepalive: often enough that a NAT mapping does not expire between two quiet nodes. */
export const WIREGUARD_KEEPALIVE_SECONDS = 25
/** How many salts a node may try before it keeps the address it has: a bound, never a loop. */
const MAX_ADDRESS_ATTEMPTS = 64

/**
 * What this node advertises to the swarm about its overlay membership.
 *
 * The schema is the contract: the stored value is JSON written by this agent and read back by it, so parsing it is one
 * `safeParse` rather than a chain of `typeof` checks that can silently drift from the type.
 */
export const overlaySelfSchema = z.object({
    wireguardKey: z.string().min(1),
    meshAddress: z.string().min(1),
    endpoint: z.string().min(1),
    listenPort: z.number().int(),
})

export type OverlaySelf = z.infer<typeof overlaySelfSchema>

/** FNV-1a over the node id and the salt: cheap, stable and identical on every node. */
function fnv1a(input: string): number {
    let hash = 0x811c9dc5
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return hash >>> 0
}

/** The address a node holds for a given salt. Hosts run 1..65534, so `.0` and `.255` never appear in the last octet. */
export function overlayAddressFor(nodeId: string, salt: number): string {
    const host = (fnv1a(`${nodeId}#${String(salt)}`) % 65_534) + 1
    return `${OVERLAY_NETWORK}.${String((host >> 8) & 0xff)}.${String(host & 0xff)}`
}

/**
 * The address and salt this node settles on, given what the other nodes advertise.
 *
 * A collision is only resolved against a node with a LOWER id: that node keeps the address and this one moves. Two
 * nodes computing at the same time therefore never move together, and a node that already moved (its salt is stored)
 * stays where it is.
 */
export function settleOverlayAddress(
    nodeId: string,
    salt: number,
    taken: ReadonlyMap<string, string>
): { readonly salt: number; readonly address: string } {
    for (
        let attempt = salt;
        attempt < salt + MAX_ADDRESS_ATTEMPTS;
        attempt += 1
    ) {
        const address = overlayAddressFor(nodeId, attempt)
        let contested = false
        for (const [otherId, otherAddress] of taken) {
            if (otherAddress === address && otherId < nodeId) {
                contested = true
                break
            }
        }
        if (!contested) return { salt: attempt, address }
    }
    return { salt, address: overlayAddressFor(nodeId, salt) }
}

/** `host:port` to dial for WireGuard, from the websocket address this agent advertises. Null when it names no host. */
export function overlayEndpoint(
    advertisedUrl: string,
    listenPort: number
): string | null {
    try {
        const url = new URL(advertisedUrl)
        if (url.hostname === '') return null
        // `URL.hostname` already brackets an IPv6 literal, which is exactly what a WireGuard endpoint needs.
        return `${url.hostname}:${String(listenPort)}`
    } catch {
        return null
    }
}

/** The overlay identity stored on this node, or null when it has none (or the stored value is not one). */
export function parseOverlaySelf(
    value: string | undefined
): OverlaySelf | null {
    if (value === undefined) return null
    let raw: unknown
    try {
        raw = JSON.parse(value)
    } catch {
        return null
    }
    const parsed = overlaySelfSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
}
