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
    it("returns a routable address, not loopback", async () => {
        const address = await resolveSwarmNodeAddress();

        expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        expect(address.startsWith("127.")).toBe(false);
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
