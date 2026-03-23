import { describe, it, expect } from "vitest";
import { signMeshToken, verifyMeshToken } from "./index";

// We need to access the module-level seenNonces set between tests.
// The simplest approach is to use a fresh module import per describe block —
// but since vitest caches modules, we instead use short windows so nonces
// expire quickly and use unique nonce collisions only where intentional.

const SECRET = "test-shared-secret-abc123";

describe("signMeshToken", () => {
    it("produces a v1.<ts>.<nonce>.<sig> token with four dot-delimited parts", () => {
        const token = signMeshToken(SECRET);
        const parts = token.split(".");
        expect(parts).toHaveLength(4);
        expect(parts[0]).toBe("v1");
    });

    it("embeds a recent timestamp (within 500 ms)", () => {
        const before = Date.now();
        const token = signMeshToken(SECRET);
        const ts = Number(token.split(".")[1]);
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(Date.now() + 500);
    });

    it("produces a different nonce on each call (probabilistically)", () => {
        const n1 = signMeshToken(SECRET).split(".")[2];
        const n2 = signMeshToken(SECRET).split(".")[2];
        expect(n1).not.toBe(n2);
    });

    it("produces different tokens for different secrets", () => {
        const t1 = signMeshToken("secret-a");
        const t2 = signMeshToken("secret-b");
        // Different HMAC segments
        expect(t1.split(".")[3]).not.toBe(t2.split(".")[3]);
    });
});

describe("verifyMeshToken — happy path", () => {
    it("accepts a freshly signed token", () => {
        const token = signMeshToken(SECRET);
        expect(verifyMeshToken(token, SECRET)).toBe(true);
    });

    it("accepts with a generous custom window", () => {
        const token = signMeshToken(SECRET);
        expect(verifyMeshToken(token, SECRET, 60_000)).toBe(true);
    });
});

describe("verifyMeshToken — structural rejections", () => {
    it("rejects null", () => { expect(verifyMeshToken(null, SECRET)).toBe(false); });
    it("rejects undefined", () => { expect(verifyMeshToken(undefined, SECRET)).toBe(false); });
    it("rejects empty string", () => { expect(verifyMeshToken("", SECRET)).toBe(false); });
    it("rejects bare secret (no dots)", () => { expect(verifyMeshToken(SECRET, SECRET)).toBe(false); });
    it("rejects wrong version prefix", () => {
        const t = signMeshToken(SECRET);
        expect(verifyMeshToken(t.replace(/^v1\./, "v2."), SECRET)).toBe(false);
    });
    it("rejects missing signature (3 parts)", () => {
        const parts = signMeshToken(SECRET).split(".");
        const ts = parts[1]!;
        const nonce = parts[2]!;
        expect(verifyMeshToken(`v1.${ts}.${nonce}`, SECRET)).toBe(false);
    });
    it("rejects non-numeric timestamp", () => {
        expect(verifyMeshToken("v1.not-a-number.aabbcc.deadbeef", SECRET)).toBe(false);
    });
    it("rejects token with wrong number of parts (5)", () => {
        expect(verifyMeshToken("v1.1.2.3.4", SECRET)).toBe(false);
    });
});

describe("verifyMeshToken — HMAC integrity", () => {
    it("rejects a token signed with a different secret", () => {
        const token = signMeshToken("secret-x");
        expect(verifyMeshToken(token, "secret-y")).toBe(false);
    });

    it("rejects a token with a tampered payload (nonce changed)", () => {
        const parts = signMeshToken(SECRET).split(".");
        const ver = parts[0]!;
        const ts = parts[1]!;
        const sig = parts[3]!;
        const forged = `${ver}.${ts}.0000000000000000.${sig}`;
        expect(verifyMeshToken(forged, SECRET)).toBe(false);
    });

    it("rejects a token with a tampered timestamp", () => {
        const parts = signMeshToken(SECRET).split(".");
        const nonce = parts[2]!;
        const sig = parts[3]!;
        const forged = `v1.${String(Date.now() + 1)}.${nonce}.${sig}`;
        expect(verifyMeshToken(forged, SECRET)).toBe(false);
    });
});

describe("verifyMeshToken — replay window", () => {
    it("rejects a token whose timestamp is in the past beyond the window", () => {
        const token = signMeshToken(SECRET);
        // Reconstruct with a past timestamp; signature won't match by definition,
        // but the window check should fire first.
        const parts = token.split(".");
        const nonce = parts[2]!;
        const sig = parts[3]!;
        const pastTs = String(Date.now() - 60_000);
        const staleToken = `v1.${pastTs}.${nonce}.${sig}`;
        // Will be rejected (sig mismatch + window exceeded)
        expect(verifyMeshToken(staleToken, SECRET, 30_000)).toBe(false);
    });

    it("rejects a token whose timestamp is far in the future (clock skew attack)", () => {
        const token = signMeshToken(SECRET);
        const parts = token.split(".");
        const nonce = parts[2]!;
        const sig = parts[3]!;
        const futureTs = String(Date.now() + 60_000);
        const futureToken = `v1.${futureTs}.${nonce}.${sig}`;
        expect(verifyMeshToken(futureToken, SECRET, 30_000)).toBe(false);
    });

    it("rejects a valid token the second time it is presented (nonce replay)", () => {
        // Use a very long window so time doesn't expire.
        // We need a fresh token — vitest module cache ensures seenNonces is shared.
        const token = signMeshToken(SECRET);
        const first = verifyMeshToken(token, SECRET, 300_000);
        const second = verifyMeshToken(token, SECRET, 300_000);
        expect(first).toBe(true);
        expect(second).toBe(false); // nonce already recorded
    });
});
