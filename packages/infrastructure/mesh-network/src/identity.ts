/**
 * Member identity — two key pairs a node generates for itself and never shares.
 *
 *   signing key    ed25519   signs every record the member authors (its roster
 *                            entry, the admissions it grants, settings it writes)
 *   WireGuard key  x25519    the member's tunnel identity; WireGuard binds the
 *                            member's mesh address to this key, which is what lets
 *                            a peer trust the SOURCE ADDRESS of a mesh packet
 *
 * Nothing issues these. A member's id is derived from its signing key and its mesh
 * address from its WireGuard key, so no online authority is ever needed to say who
 * a member is or where it lives — the property the whole mesh is built on.
 *
 * Keys travel as standard base64 of the raw 32 bytes, which is exactly WireGuard's
 * own key format (`wg pubkey` accepts our private keys unchanged).
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

import { canonicalJson } from "./canonical-json";

/** A member's full identity, private halves included. Stays on its node. */
export type MeshIdentity = {
	memberId: string;
	/** ed25519 public key, base64 raw. */
	signingKey: string;
	/** ed25519 private key, base64 raw. */
	signingPrivateKey: string;
	/** x25519 public key, base64 raw (WireGuard format). */
	wireguardKey: string;
	/** x25519 private key, base64 raw (WireGuard format). */
	wireguardPrivateKey: string;
}

export class MeshKeyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MeshKeyError";
	}
}

// PKCS#8 DER prefixes for a raw 32-byte OKP private key. Importing through DER
// rather than JWK means a stored private key is enough on its own — the public half
// is always re-derived, so a corrupted identity file cannot pair a private key with
// someone else's public key.
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
// SPKI DER prefix for a raw 32-byte ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const RAW_KEY_LENGTH = 32;

function rawKey(base64: string, label: string): Buffer {
	const raw = Buffer.from(base64, "base64");
	if (raw.length !== RAW_KEY_LENGTH || raw.toString("base64") !== base64) {
		throw new MeshKeyError(`${label} must be base64 of exactly ${String(RAW_KEY_LENGTH)} bytes`);
	}
	return raw;
}

function jwkPublicToBase64(jwkX: string | undefined): string {
	if (jwkX === undefined) throw new MeshKeyError("key export produced no public component");
	return Buffer.from(jwkX, "base64url").toString("base64");
}

function jwkPrivateToBase64(jwkD: string | undefined): string {
	if (jwkD === undefined) throw new MeshKeyError("key export produced no private component");
	return Buffer.from(jwkD, "base64url").toString("base64");
}

function ed25519PrivateKey(privateKey: string) {
	return createPrivateKey({
		key: Buffer.concat([ED25519_PKCS8_PREFIX, rawKey(privateKey, "signing private key")]),
		format: "der",
		type: "pkcs8",
	});
}

function ed25519PublicKey(publicKey: string) {
	return createPublicKey({
		key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey(publicKey, "signing key")]),
		format: "der",
		type: "spki",
	});
}

function sha256Hex(input: string | Buffer): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * A member's id: a hash of its signing key.
 *
 * Derived, never chosen, so a member cannot claim another's id: any record naming
 * member `m…` must carry the key that hashes to it.
 */
export function deriveMemberId(signingKey: string): string {
	return `m${sha256Hex(rawKey(signingKey, "signing key")).slice(0, 24)}`;
}

/**
 * The cluster's id: a hash of the founding member's signing key.
 *
 * Domain-separated from `deriveMemberId` so the founder's member id and the
 * cluster id can never be confused for one another.
 */
export function deriveClusterId(genesisSigningKey: string): string {
	return `c${sha256Hex(Buffer.concat([Buffer.from("deployer-mesh-cluster:"), rawKey(genesisSigningKey, "signing key")])).slice(0, 24)}`;
}

/** The WireGuard public key for a WireGuard private key (`wg pubkey`). */
export function wireguardPublicKeyFromPrivate(wireguardPrivateKey: string): string {
	const privateKey = createPrivateKey({
		key: Buffer.concat([X25519_PKCS8_PREFIX, rawKey(wireguardPrivateKey, "WireGuard private key")]),
		format: "der",
		type: "pkcs8",
	});
	return jwkPublicToBase64(createPublicKey(privateKey).export({ format: "jwk" }).x);
}

/** The ed25519 public key for an ed25519 private key. */
export function signingPublicKeyFromPrivate(signingPrivateKey: string): string {
	return jwkPublicToBase64(createPublicKey(ed25519PrivateKey(signingPrivateKey)).export({ format: "jwk" }).x);
}

/** Generate a brand-new identity. Called once per member, on first boot. */
export function generateMeshIdentity(): MeshIdentity {
	const signing = generateKeyPairSync("ed25519");
	const wireguard = generateKeyPairSync("x25519");
	const signingKey = jwkPublicToBase64(signing.publicKey.export({ format: "jwk" }).x);
	return {
		memberId: deriveMemberId(signingKey),
		signingKey,
		signingPrivateKey: jwkPrivateToBase64(signing.privateKey.export({ format: "jwk" }).d),
		wireguardKey: jwkPublicToBase64(wireguard.publicKey.export({ format: "jwk" }).x),
		wireguardPrivateKey: jwkPrivateToBase64(wireguard.privateKey.export({ format: "jwk" }).d),
	};
}

/**
 * Rebuild an identity from its two private keys.
 *
 * The public halves and the member id are RE-DERIVED rather than read back, so a
 * persisted identity is self-consistent by construction.
 */
export function restoreMeshIdentity(keys: { signingPrivateKey: string; wireguardPrivateKey: string }): MeshIdentity {
	const signingKey = signingPublicKeyFromPrivate(keys.signingPrivateKey);
	return {
		memberId: deriveMemberId(signingKey),
		signingKey,
		signingPrivateKey: keys.signingPrivateKey,
		wireguardKey: wireguardPublicKeyFromPrivate(keys.wireguardPrivateKey),
		wireguardPrivateKey: keys.wireguardPrivateKey,
	};
}

/** Sign the canonical form of `payload`. Returns base64. */
export function signPayload(payload: unknown, signingPrivateKey: string): string {
	return sign(null, Buffer.from(canonicalJson(payload)), ed25519PrivateKey(signingPrivateKey)).toString("base64");
}

/**
 * Verify `signature` over the canonical form of `payload`.
 *
 * Returns false — never throws — for a malformed key or signature: verification
 * runs on records received from peers, and a garbage record must be dropped, not
 * crash the merge that is processing it.
 */
export function verifyPayload(payload: unknown, signature: string, signingKey: string): boolean {
	try {
		return verify(null, Buffer.from(canonicalJson(payload)), ed25519PublicKey(signingKey), Buffer.from(signature, "base64"));
	} catch {
		return false;
	}
}
