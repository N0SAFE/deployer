/**
 * Minimal STUN (RFC 5389) binding request/response — how a member learns the public
 * address its NAT gives it, from a server that keeps no state about it.
 *
 * Only the binding exchange is implemented: the agent needs its reflexive IPv4
 * address and nothing else from STUN. Public STUN servers are interchangeable and
 * hold nothing, so depending on them does not reintroduce a source of truth.
 */

const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const MAGIC_COOKIE = 0x2112a442;
const ATTR_MAPPED_ADDRESS = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;
const FAMILY_IPV4 = 0x01;
const HEADER_LENGTH = 20;
export const STUN_TRANSACTION_ID_LENGTH = 12;

/** Public STUN servers tried by default. Any one answering is enough. */
export const DEFAULT_STUN_SERVERS = ["stun.cloudflare.com:3478", "stun.l.google.com:19302"] as const;

export type StunMappedAddress = {
	address: string;
	port: number;
}

/** A 20-byte binding request carrying `transactionId`. */
export function encodeBindingRequest(transactionId: Buffer): Buffer {
	if (transactionId.length !== STUN_TRANSACTION_ID_LENGTH) {
		throw new RangeError(`STUN transaction id must be ${String(STUN_TRANSACTION_ID_LENGTH)} bytes`);
	}
	const message = Buffer.alloc(HEADER_LENGTH);
	message.writeUInt16BE(BINDING_REQUEST, 0);
	message.writeUInt16BE(0, 2);
	message.writeUInt32BE(MAGIC_COOKIE, 4);
	transactionId.copy(message, 8);
	return message;
}

function readIpv4(buffer: Buffer, offset: number, xorKey: number): string {
	const value = (buffer.readUInt32BE(offset) ^ xorKey) >>> 0;
	return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 0xff)).join(".");
}

/**
 * The mapped address in a binding success response, or null.
 *
 * Null — not an exception — for anything unexpected: a response for another
 * transaction, an error response, an IPv6-only mapping. UDP delivers strays and the
 * caller just waits for the next datagram.
 */
export function decodeBindingResponse(message: Buffer, transactionId: Buffer): StunMappedAddress | null {
	if (message.length < HEADER_LENGTH) return null;
	if (message.readUInt16BE(0) !== BINDING_SUCCESS) return null;
	if (message.readUInt32BE(4) !== MAGIC_COOKIE) return null;
	if (!message.subarray(8, HEADER_LENGTH).equals(transactionId)) return null;

	const end = Math.min(message.length, HEADER_LENGTH + message.readUInt16BE(2));
	let offset = HEADER_LENGTH;
	let mapped: StunMappedAddress | null = null;
	while (offset + 4 <= end) {
		const type = message.readUInt16BE(offset);
		const length = message.readUInt16BE(offset + 2);
		const value = offset + 4;
		if (value + length > end) break;
		if ((type === ATTR_XOR_MAPPED_ADDRESS || type === ATTR_MAPPED_ADDRESS) && length >= 8 && message.readUInt8(value + 1) === FAMILY_IPV4) {
			const xor = type === ATTR_XOR_MAPPED_ADDRESS;
			const decoded = {
				port: message.readUInt16BE(value + 2) ^ (xor ? MAGIC_COOKIE >>> 16 : 0),
				address: readIpv4(message, value + 4, xor ? MAGIC_COOKIE : 0),
			};
			// XOR-MAPPED-ADDRESS is authoritative (NATs rewrite plain addresses in payloads).
			if (xor) return decoded;
			mapped = decoded;
		}
		offset = value + length + ((4 - (length % 4)) % 4);
	}
	return mapped;
}
