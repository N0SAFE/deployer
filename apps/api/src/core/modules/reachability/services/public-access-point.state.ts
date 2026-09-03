/**
 * Public Access Point — core state type.
 *
 * The single, checked answer to "where is this node reachable, and is it
 * actually up?". Populated from the node network config (public IP/hostname or
 * a DNS-provider-backed tunnel) plus a live probe of the node's own endpoints.
 * Broadcast through the global relay observable (see PublicAccessPointRelayService).
 */
export type PublicAccessPointKind = "ip" | "hostname" | "tunnel" | null;

export interface PublicAccessPointState {
    /** Whether any access point is configured (address or tunnel hostname). */
    configured: boolean;
    /** What kind of access point is configured. */
    kind: PublicAccessPointKind;
    /** Raw configured value (IP, hostname, or tunnel hostname). */
    address: string | null;
    /** Full origin + path, e.g. https://example.com/base or http://203.0.113.10. */
    publicUrl: string | null;
    /** DNS provider account backing the tunnel (when tunnel-based). */
    providerId: string | null;
    tunnelEnabled: boolean;
    /** Live probe result — null before the first check. */
    reachable: boolean | null;
    lastCheckedAt: string | null;
    latencyMs: number | null;
    statusCode: number | null;
    /** Why it's not configured / not reachable (null when healthy). */
    error: string | null;
}

export const EMPTY_PUBLIC_ACCESS_POINT_STATE: PublicAccessPointState = {
    configured: false,
    kind: null,
    address: null,
    publicUrl: null,
    providerId: null,
    tunnelEnabled: false,
    reachable: null,
    lastCheckedAt: null,
    latencyMs: null,
    statusCode: null,
    error: null,
};
