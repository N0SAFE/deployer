import { describe, expect, it } from "vitest";

import { chooseEndpoint, declaredAddresses, isAskedServer } from "./endpoint-discovery";

const NO_SOURCES = { advertisedUrl: undefined, declared: [], lan: [], reflexive: null, listenPort: 51820 } as const;

describe("declaredAddresses", () => {
	it("parses a comma separated list and drops what is not an IPv4 address", () => {
		expect(declaredAddresses(" 203.0.113.7 , nope, 10.0.0.5 , 300.1.1.1, , 203.0.113.7 ")).toEqual([
			"203.0.113.7",
			"10.0.0.5",
			"203.0.113.7",
		]);
	});

	it("has nothing declared when the value is empty", () => {
		expect(declaredAddresses("")).toEqual([]);
	});
});

describe("isAskedServer", () => {
	it("accepts a binding response only from the server that was asked", () => {
		const asked = { address: "203.0.113.9", port: 3478 };

		expect(isAskedServer(asked, { address: "203.0.113.9", port: 3478 })).toBe(true);
		// A stray datagram from anywhere else must not be able to name this node's address.
		expect(isAskedServer(asked, { address: "198.51.100.1", port: 3478 })).toBe(false);
		expect(isAskedServer(asked, { address: "203.0.113.9", port: 3479 })).toBe(false);
	});
});

describe("chooseEndpoint", () => {
	it("prefers the host in the advertised URL over every discovered source", () => {
		expect(
			chooseEndpoint({
				advertisedUrl: "ws://node.example:7000/mesh/ws",
				declared: ["203.0.113.7"],
				lan: ["192.168.1.20"],
				reflexive: "198.51.100.9",
				listenPort: 51820,
			}),
		).toBe("node.example:51820");
	});

	it("falls to the first declared address when the advertised URL names no host", () => {
		expect(
			chooseEndpoint({
				...NO_SOURCES,
				advertisedUrl: "not-a-url",
				declared: ["203.0.113.7", "10.0.0.5"],
				lan: ["192.168.1.20"],
				reflexive: "198.51.100.9",
			}),
		).toBe("203.0.113.7:51820");
	});

	it("falls to the first LAN address when nothing is declared", () => {
		expect(chooseEndpoint({ ...NO_SOURCES, lan: ["10.0.0.5", "192.168.1.20"], reflexive: "198.51.100.9" })).toBe(
			"10.0.0.5:51820",
		);
	});

	it("falls to the reflexive address last", () => {
		expect(chooseEndpoint({ ...NO_SOURCES, reflexive: "198.51.100.9" })).toBe("198.51.100.9:51820");
	});

	it("brackets an IPv6 host", () => {
		expect(chooseEndpoint({ ...NO_SOURCES, lan: ["2001:db8::1"] })).toBe("[2001:db8::1]:51820");
		expect(chooseEndpoint({ ...NO_SOURCES, advertisedUrl: "ws://[2001:db8::1]:7000/mesh/ws" })).toBe(
			"[2001:db8::1]:51820",
		);
	});

	it("has no endpoint when no source has one", () => {
		expect(chooseEndpoint(NO_SOURCES)).toBeNull();
	});
});
