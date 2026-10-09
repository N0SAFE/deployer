/**
 * Mesh addresses — derived from a member's WireGuard key, never allocated.
 *
 * An allocator is a source of truth: someone has to be online to hand out the next
 * free address, and two partitions handing out addresses independently collide.
 * Deriving the address from the key removes the allocator entirely — any member can
 * compute any other member's address from its roster entry, and a joiner knows its
 * own address before it has spoken to anyone.
 *
 * The price is a small collision probability inside the CIDR. It is resolved
 * deterministically (see `addressConflictLosers` in the roster): the
 * later-admitted member re-derives with the next `salt`, which every other member
 * can verify because the salt is part of its signed entry.
 */

import { createHash } from "node:crypto";

/** Default mesh CIDR: inside the shared address space (RFC 6598), not a LAN range. */
export const DEFAULT_MESH_CIDR = "100.88.0.0/16";

export class MeshAddressError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MeshAddressError";
	}
}

export type Ipv4Cidr = {
	/** Network address as an unsigned 32-bit integer. */
	network: number;
	prefix: number;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Parse a dotted IPv4 address into an unsigned 32-bit integer. */
export function ipv4ToInt(address: string): number {
	const match = IPV4_PATTERN.exec(address);
	if (match === null) throw new MeshAddressError(`not an IPv4 address: ${address}`);
	let value = 0;
	for (let index = 1; index <= 4; index += 1) {
		const octet = Number(match[index]);
		if (octet > 255) throw new MeshAddressError(`not an IPv4 address: ${address}`);
		value = value * 256 + octet;
	}
	return value;
}

/** Format an unsigned 32-bit integer as a dotted IPv4 address. */
export function intToIpv4(value: number): string {
	return [24, 16, 8, 0].map((shift) => String(Math.floor(value / 2 ** shift) % 256)).join(".");
}

/** Whether `address` is a syntactically valid IPv4 address. */
export function isIpv4(address: string): boolean {
	try {
		ipv4ToInt(address);
		return true;
	} catch {
		return false;
	}
}

/**
 * Parse `a.b.c.d/p`.
 *
 * Refuses prefixes longer than /30: below that there is no room for even two
 * members once the network and broadcast addresses are excluded.
 */
export function parseCidr(cidr: string): Ipv4Cidr {
	const [address, prefixText, ...rest] = cidr.split("/");
	if (address === undefined || prefixText === undefined || rest.length > 0 || !/^\d{1,2}$/.test(prefixText)) {
		throw new MeshAddressError(`not an IPv4 CIDR: ${cidr}`);
	}
	const prefix = Number(prefixText);
	if (prefix < 8 || prefix > 30) throw new MeshAddressError(`mesh CIDR prefix must be between /8 and /30: ${cidr}`);
	const size = 2 ** (32 - prefix);
	const network = ipv4ToInt(address);
	if (network % size !== 0) throw new MeshAddressError(`${cidr} has host bits set`);
	return { network, prefix };
}

/** Whether `address` lies inside `cidr`. */
export function cidrContains(cidr: string, address: string): boolean {
	const { network, prefix } = parseCidr(cidr);
	const value = ipv4ToInt(address);
	return value >= network && value < network + 2 ** (32 - prefix);
}

/**
 * The mesh address for a WireGuard key.
 *
 * Hash `(key, salt)` onto the usable hosts of the CIDR — the network and broadcast
 * addresses are excluded, so a derived address is always assignable.
 */
export function deriveMeshAddress(wireguardKey: string, cidr: string, salt: number): string {
	if (!Number.isInteger(salt) || salt < 0) throw new MeshAddressError(`salt must be a non-negative integer: ${String(salt)}`);
	const { network, prefix } = parseCidr(cidr);
	const usableHosts = 2 ** (32 - prefix) - 2;
	const digest = createHash("sha256").update(`deployer-mesh-address:${wireguardKey}:${String(salt)}`).digest();
	const offset = digest.readUInt32BE(0) % usableHosts;
	return intToIpv4(network + 1 + offset);
}

/** Prefix length of a CIDR, for `ip address add <address>/<prefix>`. */
export function cidrPrefix(cidr: string): number {
	return parseCidr(cidr).prefix;
}
