import { describe, expect, it } from "vitest";

import { primaryLanAddress } from "@deployer/node-agent-container";

import { lanAddresses } from "./host-addresses";

import type { NetworkInterfaceInfo } from "node:os";

const info = (address: string, overrides: Partial<NetworkInterfaceInfo> = {}): NetworkInterfaceInfo =>
	({ address, family: "IPv4", internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: `${address}/24`, ...overrides }) as NetworkInterfaceInfo;

describe("lanAddresses", () => {
	it("lists the LAN IPv4 addresses, sorted, and ignores what is never a peer's way in", () => {
		const addresses = lanAddresses({
			eth0: [info("192.168.1.20")],
			eth1: [info("10.0.0.5")],
			lo: [info("127.0.0.1", { internal: true })],
			docker0: [info("172.17.0.1")],
			"br-abc": [info("172.18.0.1")],
			veth1: [info("172.19.0.1")],
			"deployer-mesh": [info("10.88.1.2")],
			"eth2": [info("169.254.3.4")],
			"eth3": [info("2001:db8::1", { family: "IPv6" } as never)],
		});

		expect(addresses).toEqual(["10.0.0.5", "192.168.1.20"]);
	});
});

describe("primaryLanAddress", () => {
	it("has no primary address on a node with only loopback and Docker bridges", () => {
		expect(primaryLanAddress({ lo: [info("127.0.0.1", { internal: true })], docker0: [info("172.17.0.1")] })).toBeNull();
	});

	it("picks the first sorted address, so a door does not move between ticks", () => {
		expect(primaryLanAddress({ eth0: [info("192.168.1.20")], eth1: [info("10.0.0.5")] })).toBe("10.0.0.5");
	});
});
