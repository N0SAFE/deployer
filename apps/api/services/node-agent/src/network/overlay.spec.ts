import { describe, expect, it } from "vitest";

import { overlayAddressFor, overlayEndpoint, parseOverlaySelf, settleOverlayAddress } from "./overlay";

describe("overlayAddressFor", () => {
	it("is deterministic and stays inside 10.88/16 with a usable host", () => {
		for (const nodeId of ["a", "node-1", "node-self", "abcdef0123456789"]) {
			for (let salt = 0; salt < 40; salt += 1) {
				const address = overlayAddressFor(nodeId, salt);
				expect(overlayAddressFor(nodeId, salt)).toBe(address);
				expect(address).toMatch(/^10\.88\.\d+\.\d+$/);
				const fourth = Number(address.split(".")[3]);
				expect(fourth).not.toBe(0);
				expect(fourth).not.toBe(255);
			}
		}
	});
});

describe("settleOverlayAddress", () => {
	const self = "node-self";

	it("keeps its address when nobody holds it", () => {
		const settled = settleOverlayAddress(self, 0, new Map());
		expect(settled).toEqual({ salt: 0, address: overlayAddressFor(self, 0) });
	});

	it("moves when a node with a lower id holds the address", () => {
		const held = overlayAddressFor(self, 0);
		const settled = settleOverlayAddress(self, 0, new Map([["aaa", held]]));

		expect(settled.address).not.toBe(held);
		expect(settled.salt).toBeGreaterThan(0);
	});

	it("keeps the address when a node with a higher id holds it", () => {
		const held = overlayAddressFor(self, 0);
		const settled = settleOverlayAddress(self, 0, new Map([["zzz", held]]));

		expect(settled).toEqual({ salt: 0, address: held });
	});

	it("is stable on repeat with the same salt and roster", () => {
		const taken = new Map([["aaa", overlayAddressFor(self, 0)]]);
		const first = settleOverlayAddress(self, 0, taken);
		const second = settleOverlayAddress(self, first.salt, taken);

		expect(second).toEqual(first);
	});
});

describe("overlayEndpoint", () => {
	it("turns an advertised websocket address into a dialable host:port", () => {
		expect(overlayEndpoint("ws://node.example:7000/mesh/ws", 51820)).toBe("node.example:51820");
		expect(overlayEndpoint("ws://10.0.0.5:7000/mesh/ws", 51820)).toBe("10.0.0.5:51820");
	});

	it("returns null when the address names no host", () => {
		expect(overlayEndpoint("not-a-url", 51820)).toBeNull();
		expect(overlayEndpoint("", 51820)).toBeNull();
		expect(overlayEndpoint("ws://:7000/mesh/ws", 51820)).toBeNull();
	});
});

describe("parseOverlaySelf", () => {
	const self = { wireguardKey: "pub", meshAddress: "10.88.1.2", endpoint: "node.example:51820", listenPort: 51820 };

	it("round-trips what the tick stored", () => {
		expect(parseOverlaySelf(JSON.stringify(self))).toEqual(self);
	});

	it("returns null for a missing or malformed value", () => {
		expect(parseOverlaySelf(undefined)).toBeNull();
		expect(parseOverlaySelf("not json")).toBeNull();
		expect(parseOverlaySelf("[]")).toBeNull();
		expect(parseOverlaySelf('{"meshAddress":"10.88.1.2"}')).toBeNull();
		expect(parseOverlaySelf('{"wireguardKey":"pub","meshAddress":"10.88.1.2","endpoint":"h:1","listenPort":1.5}')).toBeNull();
	});
});
