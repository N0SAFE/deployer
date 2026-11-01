import { describe, expect, it } from "vitest";

import { STUN_TRANSACTION_ID_LENGTH, decodeBindingResponse, encodeBindingRequest } from "./stun";

const MAGIC_COOKIE = 0x2112a442;
const TRANSACTION_ID = Buffer.from("00112233445566778899aabb", "hex");

function ipv4ToInt(address: string): number {
	return address
		.split(".")
		.reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

/** A canned RFC 5389 binding success carrying one XOR-MAPPED-ADDRESS (`attribute` 0x0020 when `xor`). */
function bindingResponse(options: { transactionId?: Buffer; xor?: boolean; port?: number; address?: string } = {}): Buffer {
	const transactionId = options.transactionId ?? TRANSACTION_ID;
	const port = options.port ?? 51820;
	const address = options.address ?? "203.0.113.7";
	const xor = options.xor ?? true;

	const header = Buffer.alloc(20);
	header.writeUInt16BE(0x0101, 0);
	header.writeUInt16BE(12, 2);
	header.writeUInt32BE(MAGIC_COOKIE, 4);
	transactionId.copy(header, 8);

	const attribute = Buffer.alloc(12);
	attribute.writeUInt16BE(xor ? 0x0020 : 0x0001, 0);
	attribute.writeUInt16BE(8, 2);
	attribute.writeUInt8(0, 4);
	attribute.writeUInt8(0x01, 5);
	attribute.writeUInt16BE(port ^ (xor ? MAGIC_COOKIE >>> 16 : 0), 6);
	attribute.writeUInt32BE((ipv4ToInt(address) ^ (xor ? MAGIC_COOKIE : 0)) >>> 0, 8);

	return Buffer.concat([header, attribute]);
}

describe("encodeBindingRequest", () => {
	it("writes a 20-byte binding request with the magic cookie and the transaction id", () => {
		const request = encodeBindingRequest(TRANSACTION_ID);

		expect(request).toHaveLength(20);
		expect(request.readUInt16BE(0)).toBe(0x0001);
		expect(request.readUInt16BE(2)).toBe(0);
		expect(request.readUInt32BE(4)).toBe(MAGIC_COOKIE);
		expect(request.subarray(8)).toEqual(TRANSACTION_ID);
	});

	it("refuses a transaction id of the wrong length", () => {
		expect(() => encodeBindingRequest(Buffer.alloc(STUN_TRANSACTION_ID_LENGTH - 1))).toThrow(RangeError);
	});
});

describe("decodeBindingResponse", () => {
	it("decodes the XOR-MAPPED-ADDRESS of a binding success", () => {
		expect(decodeBindingResponse(bindingResponse({ port: 51820, address: "203.0.113.7" }), TRANSACTION_ID)).toEqual({
			address: "203.0.113.7",
			port: 51820,
		});
	});

	it("decodes a plain MAPPED-ADDRESS", () => {
		expect(decodeBindingResponse(bindingResponse({ xor: false, port: 3478, address: "10.0.0.5" }), TRANSACTION_ID)).toEqual({
			address: "10.0.0.5",
			port: 3478,
		});
	});

	it("is null for another transaction, an error response, another cookie, or a truncated message", () => {
		expect(decodeBindingResponse(bindingResponse(), Buffer.alloc(STUN_TRANSACTION_ID_LENGTH))).toBeNull();

		const error = bindingResponse();
		error.writeUInt16BE(0x0111, 0);
		expect(decodeBindingResponse(error, TRANSACTION_ID)).toBeNull();

		const foreignCookie = bindingResponse();
		foreignCookie.writeUInt32BE(0, 4);
		expect(decodeBindingResponse(foreignCookie, TRANSACTION_ID)).toBeNull();

		expect(decodeBindingResponse(Buffer.alloc(8), TRANSACTION_ID)).toBeNull();
	});
});
