import { describe, expect, it } from "vitest";

import {
    resolveSwarmNodeAddress,
    swarmInitOptions,
} from "../swarm-bootstrap.service";

/**
 * The swarm node address.
 *
 * These assertions exist because the previous fallback (`127.0.0.1`) looked
 * reasonable and produced a cluster that could never run an overlay. The failure
 * surfaced far away, as a setup handover timeout:
 *
 *   Cannot reach the platform overlay deployer-platform-overlay — this container
 *   could not be attached within 60s. Engine said: (HTTP code 500) … context
 *   deadline exceeded
 *
 * A swarm node advertises ONE address, used for both the control plane (2377) and
 * the VXLAN data path (4789). Loopback is valid for the control plane on a lone
 * node and invalid for the data path — every task that joins an overlay on that
 * node then tunnels to 127.0.0.1 and the sandbox join never converges.
 */
describe("swarmInitOptions", () => {
    it("never advertises loopback when no mesh address is available", () => {
        const options = swarmInitOptions(null, "10.1.2.3");

        expect(options.AdvertiseAddr).toBe("10.1.2.3:2377");
        expect(options.ListenAddr).toBe("10.1.2.3:2377");
        expect(options.DataPathAddr).not.toBe("127.0.0.1");
    });

    it("uses the mesh address when the mesh is up", () => {
        const options = swarmInitOptions("100.88.170.45", "10.1.2.3");

        expect(options.AdvertiseAddr).toBe("100.88.170.45:2377");
        expect(options.DataPathAddr).toBe("100.88.170.45");
    });

    it("always sets a data path, so it can never silently fall back to the control-plane default", () => {
        // The old implementation omitted `DataPathAddr` when there was no mesh,
        // leaving dockerd to infer one — which is how a loopback advertise address
        // became a loopback data path without anything saying so.
        expect(swarmInitOptions(null, "10.1.2.3").DataPathAddr).toBeDefined();
        expect(swarmInitOptions("100.88.170.45", "10.1.2.3").DataPathAddr).toBeDefined();
    });
});

describe("resolveSwarmNodeAddress", () => {
    /**
     * ── THE CONTAINER CASE ────────────────────────────────────────────────────
     * `docker swarm init --advertise-addr` is executed against the DAEMON, which
     * binds the address on the HOST. Returning the interface address INSIDE this
     * process's namespace therefore cannot work when setup is containerised:
     *
     *   manager stopped: failed to listen on remote API address:
     *   listen tcp 172.25.0.2:2377: bind: cannot assign requested address
     *
     * Measured on the affected setup container: eth0 = 172.25.0.2, default
     * gateway = 172.25.0.1, and the HOST owns .1 on that bridge. Proved against
     * the live daemon: `swarm init --advertise-addr 172.25.0.2` is rejected
     * ("not recognized as a system address"), while `172.25.0.1` succeeds and the
     * node reports `addr=172.25.0.1`.
     *
     * This test runs inside the repo's own test process, so it asserts the
     * CONTRACT rather than the container branch: whatever environment the suite
     * runs in, the answer must be a routable, non-loopback IPv4 that is not this
     * process's own loopback.
     */
    it("returns a routable address, not loopback", async () => {
        const address = await resolveSwarmNodeAddress();

        expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        expect(address.startsWith("127.")).toBe(false);
    });

    /**
     * When containerised, the answer must be the DEFAULT GATEWAY (the host), and
     * that is exactly what distinguishes it from "this container's own address".
     * The suite may run bare-metal, so both outcomes are asserted as a union —
     * what must never happen is returning the container's own eth0 address.
     */
    it("never returns this process's own container address when containerised", async () => {
        const address = await resolveSwarmNodeAddress();

        // `.dockerenv` is Docker's marker for "this process is containerised".
        const containerised = await Bun.file("/.dockerenv").exists();
        if (!containerised) {
            expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
            return;
        }

        const route = await Bun.file("/proc/net/route").text();
        let gateway: string | null = null;
        for (const line of route.split("\n").slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3 || parts[1] !== "00000000") continue;
            const hex = parts[2] ?? "";
            if (hex.length < 8) continue;
            gateway = [
                parseInt(hex.slice(6, 8), 16),
                parseInt(hex.slice(4, 6), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(0, 2), 16),
            ].join(".");
            break;
        }

        expect(gateway).not.toBeNull();
        expect(address).toBe(gateway);
    });

    it("prefers an explicit operator override", async () => {
        const previous = process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
        process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = "10.9.8.7";
        try {
            expect(await resolveSwarmNodeAddress()).toBe("10.9.8.7");
        } finally {
            if (previous === undefined) delete process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
            else process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = previous;
        }
    });

    it("ignores an override that is itself loopback", async () => {
        const previous = process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
        process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = "127.0.0.1";
        try {
            // An operator asking for loopback reproduces the exact broken cluster
            // this function exists to prevent, so the request is refused.
            expect(await resolveSwarmNodeAddress()).not.toBe("127.0.0.1");
        } finally {
            if (previous === undefined) delete process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
            else process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = previous;
        }
    });

    it("ignores an override that is not an IPv4 address", async () => {
        const previous = process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
        process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = "not-an-ip";
        try {
            expect(await resolveSwarmNodeAddress()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        } finally {
            if (previous === undefined) delete process.env.DEPLOYER_SWARM_ADVERTISE_ADDR;
            else process.env.DEPLOYER_SWARM_ADVERTISE_ADDR = previous;
        }
    });
});
