import { describe, expect, it } from "vitest";

import { cidrContains, deriveMeshAddress, intToIpv4, ipv4ToInt, MeshAddressError, parseCidr } from "../address";
import { generateMeshIdentity } from "../identity";

describe("address", () => {
	it("round-trips IPv4 addresses through integers", () => {
		expect(intToIpv4(ipv4ToInt("100.88.255.1"))).toBe("100.88.255.1");
		expect(ipv4ToInt("255.255.255.255")).toBe(4_294_967_295);
	});

	it("rejects malformed addresses and CIDRs", () => {
		expect(() => ipv4ToInt("256.1.1.1")).toThrow(MeshAddressError);
		expect(() => parseCidr("100.88.0.1/16")).toThrow(/host bits/);
		expect(() => parseCidr("100.88.0.0/31")).toThrow(MeshAddressError);
		expect(() => parseCidr("100.88.0.0")).toThrow(MeshAddressError);
	});

	it("derives the same address for the same key, inside the CIDR", () => {
		const { wireguardKey } = generateMeshIdentity();
		const address = deriveMeshAddress(wireguardKey, "100.88.0.0/16", 0);
		expect(deriveMeshAddress(wireguardKey, "100.88.0.0/16", 0)).toBe(address);
		expect(cidrContains("100.88.0.0/16", address)).toBe(true);
	});

	it("moves to a different address when the salt changes", () => {
		const { wireguardKey } = generateMeshIdentity();
		const seen = new Set([0, 1, 2, 3].map((salt) => deriveMeshAddress(wireguardKey, "100.88.0.0/16", salt)));
		expect(seen.size).toBeGreaterThan(1);
	});

	it("never yields the network or broadcast address", () => {
		for (let salt = 0; salt < 200; salt += 1) {
			const address = deriveMeshAddress("3uzaSo9c/nnOmg9ipPglHPflpyK0WmoZ4F5spNh03zI=", "10.9.9.0/30", salt);
			expect(["10.9.9.1", "10.9.9.2"]).toContain(address);
		}
	});
});
