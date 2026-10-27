import { describe, expect, it } from "vitest";
import {
	SYSTEM_ACTOR_TTL_SECONDS,
	signSystemActorClaim,
	verifySystemActorClaim,
} from "./system-actor";

const SECRET = "a-secret-that-is-long-enough-for-tests";
const NOW = new Date("2026-10-27T12:00:00Z");

describe("system actor claim", () => {
	const token = signSystemActorClaim({ source: "github-push", deliveryId: "d-1", aud: "runtime" }, SECRET, NOW);

	it("round-trips a valid claim", () => {
		expect(verifySystemActorClaim(token, SECRET, "runtime", NOW)).toMatchObject({
			kind: "system",
			source: "github-push",
			deliveryId: "d-1",
			aud: "runtime",
		});
	});

	it("rejects a different secret", () => {
		expect(verifySystemActorClaim(token, "another-secret-another-secret-1234", "runtime", NOW)).toBeNull();
	});

	it("rejects a claim addressed to another service", () => {
		expect(verifySystemActorClaim(token, SECRET, "fleet", NOW)).toBeNull();
	});

	it("rejects an expired claim", () => {
		const later = new Date(NOW.getTime() + (SYSTEM_ACTOR_TTL_SECONDS + 1) * 1000);
		expect(verifySystemActorClaim(token, SECRET, "runtime", later)).toBeNull();
	});

	it("rejects a tampered payload", () => {
		const signature = token.split(".")[1] ?? "";
		const forged = Buffer.from(
			JSON.stringify({ kind: "system", source: "evil", deliveryId: null, aud: "runtime", exp: 9999999999 }),
		).toString("base64url");
		expect(verifySystemActorClaim(`${forged}.${signature}`, SECRET, "runtime", NOW)).toBeNull();
	});

	it("rejects malformed input without throwing", () => {
		for (const bad of ["", "abc", "a.b.c", ".", "x."]) {
			expect(verifySystemActorClaim(bad, SECRET, "runtime", NOW)).toBeNull();
		}
	});
});
