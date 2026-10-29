import { describe, expect, it } from "vitest";

import { signLease, verifyLease } from "./lease-token";

const SECRET = "agent-secret";
const claims = { replicaId: "runtime-2", callerId: "bff-1", expiresAt: 10_000 };

describe("lease token", () => {
  it("verifies a token for the replica it names", () => {
    const token = signLease(claims, SECRET);

    expect(verifyLease(token, SECRET, "runtime-2", 5_000)).toEqual({ ok: true, claims });
  });

  it("rejects an expired token", () => {
    expect(verifyLease(signLease(claims, SECRET), SECRET, "runtime-2", 10_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token presented to another replica", () => {
    expect(verifyLease(signLease(claims, SECRET), SECRET, "runtime-3", 5_000)).toEqual({ ok: false, reason: "wrong-replica" });
  });

  it("rejects a token signed with another secret", () => {
    expect(verifyLease(signLease(claims, "other"), SECRET, "runtime-2", 5_000)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token whose payload was changed", () => {
    const signature = signLease(claims, SECRET).split(".")[1] ?? "";
    const forged = `${Buffer.from(JSON.stringify({ ...claims, replicaId: "runtime-3" })).toString("base64url")}.${signature}`;

    expect(verifyLease(forged, SECRET, "runtime-3", 5_000)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it.each(["", "abc", "a.b.c"])("rejects a malformed token %j", (token) => {
    expect(verifyLease(token, SECRET, "runtime-2", 5_000)).toEqual({ ok: false, reason: "malformed" });
  });
});
