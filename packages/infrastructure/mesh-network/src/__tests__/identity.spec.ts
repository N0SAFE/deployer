import { describe, expect, it } from "vitest";

import { canonicalJson, CanonicalJsonError } from "../canonical-json";
import {
	deriveClusterId,
	deriveMemberId,
	generateMeshIdentity,
	MeshKeyError,
	restoreMeshIdentity,
	signPayload,
	verifyPayload,
	wireguardPublicKeyFromPrivate,
} from "../identity";

describe("canonicalJson", () => {
	it("serialises equal records identically whatever their key order", () => {
		expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "z" } })).toBe(
			canonicalJson({ a: { c: "z", d: [3, { x: 2, y: 1 }] }, b: 1 }),
		);
	});

	it("keeps array order, because candidate ranking lives in it", () => {
		expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
	});

	it("drops undefined fields like JSON does", () => {
		expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
	});

	it("refuses non-finite numbers, which would serialise as null", () => {
		expect(() => canonicalJson({ a: Number.NaN })).toThrow(CanonicalJsonError);
	});
});

describe("identity", () => {
	it("derives WireGuard public keys exactly like `wg pubkey`", () => {
		// Vector produced by `wg genkey | tee /dev/stderr | wg pubkey`.
		expect(wireguardPublicKeyFromPrivate("wAy9CBLOLr1pvLxlCzwQu9bGTxYyNyaF9Z0w9umQVlI=")).toBe(
			"3uzaSo9c/nnOmg9ipPglHPflpyK0WmoZ4F5spNh03zI=",
		);
	});

	it("generates an identity whose id is derived from its signing key", () => {
		const identity = generateMeshIdentity();
		expect(identity.memberId).toBe(deriveMemberId(identity.signingKey));
		expect(identity.memberId).toMatch(/^m[0-9a-f]{24}$/);
		expect(wireguardPublicKeyFromPrivate(identity.wireguardPrivateKey)).toBe(identity.wireguardKey);
	});

	it("restores the same identity from its private keys alone", () => {
		const identity = generateMeshIdentity();
		expect(restoreMeshIdentity(identity)).toEqual(identity);
	});

	it("domain-separates the cluster id from the founder's member id", () => {
		const identity = generateMeshIdentity();
		expect(deriveClusterId(identity.signingKey).slice(1)).not.toBe(identity.memberId.slice(1));
	});

	it("rejects a key that is not 32 bytes of base64", () => {
		expect(() => deriveMemberId("not-a-key")).toThrow(MeshKeyError);
	});

	it("verifies a signature over the canonical form, and nothing else", () => {
		const identity = generateMeshIdentity();
		const signature = signPayload({ b: 2, a: 1 }, identity.signingPrivateKey);
		expect(verifyPayload({ a: 1, b: 2 }, signature, identity.signingKey)).toBe(true);
		expect(verifyPayload({ a: 1, b: 3 }, signature, identity.signingKey)).toBe(false);
		expect(verifyPayload({ a: 1, b: 2 }, signature, generateMeshIdentity().signingKey)).toBe(false);
	});

	it("returns false rather than throwing for garbage keys and signatures", () => {
		expect(verifyPayload({ a: 1 }, "@@@", "garbage")).toBe(false);
	});
});
