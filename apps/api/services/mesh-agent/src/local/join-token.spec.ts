import { describe, expect, it } from "vitest";

import { decodeJoinToken, encodeJoinToken } from "./join-token";

const token = { address: "ws://10.0.0.1:3106/mesh/ws", secret: "swarm-secret", swarmId: "swarm-1", expiresAt: 10_000 };

describe("join token", () => {
  it("round-trips what it carries", () => {
    expect(decodeJoinToken(encodeJoinToken(token), 5_000)).toEqual({ ok: true, token: { v: 1, ...token } });
  });

  it("is expired at its expiry, not after", () => {
    expect(decodeJoinToken(encodeJoinToken(token), 9_999).ok).toBe(true);
    expect(decodeJoinToken(encodeJoinToken(token), 10_000)).toEqual({ ok: false, reason: "expired" });
  });

  it.each([
    ["not base64 json", "%%%"],
    ["not an object", Buffer.from("42").toString("base64url")],
    ["another version", Buffer.from(JSON.stringify({ ...token, v: 2 })).toString("base64url")],
    ["a missing secret", Buffer.from(JSON.stringify({ v: 1, address: "ws://x", swarmId: "s", expiresAt: 99_999 })).toString("base64url")],
    ["an empty address", Buffer.from(JSON.stringify({ v: 1, ...token, address: "" })).toString("base64url")],
  ])("rejects %s", (_name, encoded) => {
    expect(decodeJoinToken(encoded, 0)).toEqual({ ok: false, reason: "malformed" });
  });
});
