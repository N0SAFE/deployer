/**
 * What an agent already in a swarm hands to a new one so it can join: where to find the swarm, the credential that
 * proves membership, and until when the token is good. It is the secret itself, so it is shown once and expires.
 */
export type JoinToken = {
  readonly v: 1;
  /** The websocket of an agent in the swarm. */
  readonly address: string;
  readonly secret: string;
  readonly swarmId: string;
  /** Epoch ms. */
  readonly expiresAt: number;
};

export type DecodedJoinToken =
  | { readonly ok: true; readonly token: JoinToken }
  | { readonly ok: false; readonly reason: "malformed" | "expired" };

export function encodeJoinToken(token: Omit<JoinToken, "v">): string {
  return Buffer.from(JSON.stringify({ v: 1, ...token }), "utf8").toString("base64url");
}

export function decodeJoinToken(encoded: string, now: number): DecodedJoinToken {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "malformed" };
  }
  const candidate = parsed as Partial<JoinToken>;
  if (
    candidate.v !== 1 ||
    typeof candidate.address !== "string" ||
    candidate.address.length === 0 ||
    typeof candidate.secret !== "string" ||
    candidate.secret.length === 0 ||
    typeof candidate.swarmId !== "string" ||
    candidate.swarmId.length === 0 ||
    typeof candidate.expiresAt !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (candidate.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token: { v: 1, address: candidate.address, secret: candidate.secret, swarmId: candidate.swarmId, expiresAt: candidate.expiresAt } };
}
