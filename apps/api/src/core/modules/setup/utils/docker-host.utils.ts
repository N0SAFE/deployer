import { readFileSync } from "node:fs";

/**
 * Resolve the IP address used to reach the Docker host from inside
 * this container.
 *
 * When the API runs inside a Docker container, `127.0.0.1` refers to
 * the container itself, not the host. Host-published ports (e.g. a
 * freshly provisioned Postgres container) are reachable via the
 * default gateway IP. We read that gateway from `/proc/net/route`,
 * where the default route's gateway is stored as a little-endian hex
 * string.
 *
 * Falls back to `127.0.0.1` when:
 *  - The process is not running inside a container (no
 *    `/proc/net/route` for the docker interface, or default route on
 *    the host network).
 *  - The route file cannot be read for any reason.
 */
export function resolveDockerHostIp(): string {
    try {
        const route = readFileSync("/proc/net/route", "utf8");
        for (const line of route.split("\n").slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            // Destination 00000000 = default route
            if (parts[1] !== "00000000") continue;
            const gatewayHex = parts[2] ?? "";
            if (gatewayHex.length < 8) continue;
            // Stored little-endian; reverse byte order.
            const ip = [
                parseInt(gatewayHex.slice(6, 8), 16),
                parseInt(gatewayHex.slice(4, 6), 16),
                parseInt(gatewayHex.slice(2, 4), 16),
                parseInt(gatewayHex.slice(0, 2), 16),
            ].join(".");
            // Sanity check: must look like a valid IPv4.
            if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== "0.0.0.0") {
                return ip;
            }
        }
    } catch {
        // /proc/net/route is Linux-only and only exists when /proc is mounted.
        // Outside of a container (e.g. local dev on the host) this fails,
        // and 127.0.0.1 is the correct address anyway.
    }
    return "127.0.0.1";
}
