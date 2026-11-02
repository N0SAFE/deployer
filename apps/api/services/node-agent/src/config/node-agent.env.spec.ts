import { afterEach, describe, expect, it, vi } from "vitest";

import { apiServicePort } from "@deployer/env";

import {
  MAX_RELAY_MAX_HOPS,
  parseNodeAgentEnv,
  productionImageWarning,
  resolveAdvertisedAddress,
  resolveRelaySettings,
  resolveSocketOwnership,
} from "./node-agent.env";

import type { NetworkInterfaceInfo } from "node:os";

/** The interfaces the mocked `node:os` reports: a host with a LAN interface, or one with loopback only. */
const host = vi.hoisted(() => ({ interfaces: {} }));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return {
		...actual,
		networkInterfaces: () => host.interfaces,
		// The container id: what a host-network container sees as its own name, and what no peer can dial.
		hostname: () => "container-id",
	};
});

const lan = (address: string): NetworkInterfaceInfo =>
	({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24` });

const port = apiServicePort("node-agent");

afterEach(() => {
	host.interfaces = {};
});

describe("resolveAdvertisedAddress", () => {
	it("keeps an explicit advertise URL authoritative", () => {
		host.interfaces = { eth0: [lan("10.1.2.3")] };

		expect(resolveAdvertisedAddress({ MESH_ADVERTISE_URL: "ws://node-a.example:3106/mesh/ws" })).toBe(
			"ws://node-a.example:3106/mesh/ws",
		);
	});

	it("falls back to the host's LAN address, never to a host-network container's own name", () => {
		host.interfaces = { eth0: [lan("10.1.2.3")], docker0: [lan("172.17.0.1")] };

		expect(resolveAdvertisedAddress({})).toBe(`ws://10.1.2.3:${String(port)}/mesh/ws`);
	});

	it("falls back to the host name only when the node has no LAN address at all", () => {
		host.interfaces = { lo: [lan("127.0.0.1")] };

		expect(resolveAdvertisedAddress({})).toBe(`ws://container-id:${String(port)}/mesh/ws`);
	});
});

describe("resolveSocketOwnership", () => {
	it("defaults to root, and takes the deployment's user when it names one", () => {
		expect(resolveSocketOwnership({})).toEqual({ uid: 0, gid: 0 });
		expect(resolveSocketOwnership({ NODE_AGENT_SOCKET_UID: 1000, NODE_AGENT_SOCKET_GID: 1000 })).toEqual({ uid: 1000, gid: 1000 });
	});
});

describe("resolveRelaySettings", () => {
	it("clamps the hop count to the contract's bound instead of trusting a written value", () => {
		expect(resolveRelaySettings({ MESH_RELAY_MAX_HOPS: 99 }).maxHops).toBe(MAX_RELAY_MAX_HOPS);
		expect(resolveRelaySettings({ MESH_RELAY_MAX_HOPS: 3 }).maxHops).toBe(3);
		// Zero disables forwarding and stays zero: clamping must not turn "off" into "on".
		expect(resolveRelaySettings({ MESH_RELAY_MAX_HOPS: 0 }).maxHops).toBe(0);
		expect(resolveRelaySettings({}).maxHops).toBe(2);
	});
});

describe("parseNodeAgentEnv", () => {
	it("declares the engine socket and accepts the state dir, so both are validated rather than raw", () => {
		const env = parseNodeAgentEnv({ NODE_AGENT_STATE_DIR: "/run/agent" });

		expect(env.NODE_AGENT_DOCKER_SOCKET).toBe("/var/run/docker.sock");
		expect(env.NODE_AGENT_STATE_DIR).toBe("/run/agent");
	});
});

describe("productionImageWarning", () => {
	it("says nothing outside production", () => {
		expect(productionImageWarning({ NODE_ENV: "development" })).toBeNull();
		expect(productionImageWarning({})).toBeNull();
	});

	it("warns about an unset image and a dev tag, and stays quiet for a pinned one", () => {
		expect(productionImageWarning({ NODE_ENV: "production" })).toMatch(/NODE_AGENT_IMAGE unset/);
		expect(productionImageWarning({ NODE_ENV: "production", NODE_AGENT_IMAGE: "deployer-node-agent:dev" })).toMatch(/dev tag/);
		expect(productionImageWarning({ NODE_ENV: "production", NODE_AGENT_IMAGE: "deployer-node-agent:1.2.3" })).toBeNull();
	});
});
