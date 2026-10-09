import { describe, expect, it } from "vitest";

import { decodeBindingResponse, encodeBindingRequest } from "../stun";
import { parseWireguardDump, renderWireguardConfig } from "../wireguard";

describe("renderWireguardConfig", () => {
	it("renders a syncconf file with endpoint only when planned", () => {
		const text = renderWireguardConfig({
			privateKey: "wAy9CBLOLr1pvLxlCzwQu9bGTxYyNyaF9Z0w9umQVlI=",
			listenPort: 51820,
			peers: [
				{ memberId: "a", wireguardKey: "KEY_A=", allowedIps: ["100.88.0.2/32"], endpoint: "192.168.1.20:51820", persistentKeepaliveSeconds: 25, path: "trying", candidate: null },
				{ memberId: "b", wireguardKey: "KEY_B=", allowedIps: ["100.88.0.3/32"], endpoint: null, persistentKeepaliveSeconds: 25, path: "passive", candidate: null },
			],
		});
		expect(text).toBe(
			[
				"[Interface]",
				"PrivateKey = wAy9CBLOLr1pvLxlCzwQu9bGTxYyNyaF9Z0w9umQVlI=",
				"ListenPort = 51820",
				"",
				"[Peer]",
				"PublicKey = KEY_A=",
				"AllowedIPs = 100.88.0.2/32",
				"Endpoint = 192.168.1.20:51820",
				"PersistentKeepalive = 25",
				"",
				"[Peer]",
				"PublicKey = KEY_B=",
				"AllowedIPs = 100.88.0.3/32",
				"PersistentKeepalive = 25",
				"",
			].join("\n"),
		);
	});
});

describe("parseWireguardDump", () => {
	it("parses the interface line and peers, mapping 0 handshakes to null", () => {
		const dump = [
			"PRIV\tPUB\t51820\toff",
			"PEER_A\t(none)\t192.168.1.20:51820\t100.88.0.2/32\t1759838400\t1024\t2048\t25",
			"PEER_B\t(none)\t(none)\t100.88.0.3/32\t0\t0\t0\t25",
		].join("\n");
		expect(parseWireguardDump(dump)).toEqual({
			publicKey: "PUB",
			listenPort: 51820,
			peers: {
				PEER_A: { publicKey: "PEER_A", endpoint: "192.168.1.20:51820", allowedIps: ["100.88.0.2/32"], latestHandshakeAt: 1_759_838_400_000, rxBytes: 1024, txBytes: 2048 },
				PEER_B: { publicKey: "PEER_B", endpoint: null, allowedIps: ["100.88.0.3/32"], latestHandshakeAt: null, rxBytes: 0, txBytes: 0 },
			},
		});
	});

	it("returns null for output that is not a dump", () => {
		expect(parseWireguardDump("Unable to access interface: No such device")).toBeNull();
	});
});

describe("STUN", () => {
	const transactionId = Buffer.from("0123456789ab");

	function response(type: number, address: string, port: number): Buffer {
		const message = Buffer.alloc(32);
		message.writeUInt16BE(0x0101, 0);
		message.writeUInt16BE(12, 2);
		message.writeUInt32BE(0x2112a442, 4);
		transactionId.copy(message, 8);
		message.writeUInt16BE(type, 20);
		message.writeUInt16BE(8, 22);
		message.writeUInt8(0x01, 25);
		const xor = type === 0x0020;
		message.writeUInt16BE(port ^ (xor ? 0x2112 : 0), 26);
		const value = address.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
		message.writeUInt32BE((value ^ (xor ? 0x2112a442 : 0)) >>> 0, 28);
		return message;
	}

	it("encodes a 20-byte binding request with the magic cookie", () => {
		const request = encodeBindingRequest(transactionId);
		expect(request).toHaveLength(20);
		expect(request.readUInt32BE(4)).toBe(0x2112a442);
		expect(request.subarray(8).equals(transactionId)).toBe(true);
	});

	it("decodes XOR-MAPPED-ADDRESS", () => {
		expect(decodeBindingResponse(response(0x0020, "203.0.113.7", 40123), transactionId)).toEqual({ address: "203.0.113.7", port: 40123 });
	});

	it("falls back to MAPPED-ADDRESS", () => {
		expect(decodeBindingResponse(response(0x0001, "198.51.100.9", 3478), transactionId)).toEqual({ address: "198.51.100.9", port: 3478 });
	});

	it("ignores a response for another transaction", () => {
		expect(decodeBindingResponse(response(0x0020, "203.0.113.7", 40123), Buffer.from("zzzzzzzzzzzz"))).toBeNull();
	});
});
