import z from "zod/v4";

/**
 * What an agent already in a swarm hands to a new one so it can join: where to find the swarm, the credential that
 * proves membership, and until when the token is good. It is the secret itself, so it is shown once and expires.
 */
/**
 * The token's wire shape. The schema is the parser: a token crosses a process boundary and may be old, forged or
 * truncated, so the fields are checked once, in one place, instead of in a chain of `typeof` comparisons.
 */
export const joinTokenSchema = z.object({
  v: z.literal(1),
  /** Unique id of this token: two tokens issued in the same millisecond differ, which is what makes revocation exact. */
  jti: z.string().min(1),
  /** The websocket of an agent in the swarm. */
  address: z.string().min(1),
  secret: z.string().min(1),
  swarmId: z.string().min(1),
  /** Epoch ms. */
  expiresAt: z.number(),
});

export type JoinToken = z.infer<typeof joinTokenSchema>;

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
  const token = joinTokenSchema.safeParse(parsed);
  if (!token.success) {
    return { ok: false, reason: "malformed" };
  }
  if (token.data.expiresAt <= now) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token: token.data };
}
