import { Effect, Option, Schema } from "effect";

import type { EgressPolicy, HttpRes, SafeHttpShape } from "@deployer/effect-infra";

import { PeerIdentity } from "./peer-identity";

export type Attempted = { readonly ok: true; readonly response: HttpRes } | { readonly ok: false; readonly reason: string };

/**
 * One request, collapsed to "answered 2xx with this response" or "here is why not".
 *
 * Collapsing is the point: `probePeer` reports either way, so a refused egress, a
 * 503 and a reset connection all have to become the same shape.
 */
export const requestOrReason = (
  http: SafeHttpShape,
  url: string,
  policy: EgressPolicy,
): Effect.Effect<Attempted> =>
  http.request({ url }, policy).pipe(
    Effect.map(
      (response): Attempted =>
        response.status >= 200 && response.status < 300
          ? { ok: true, response }
          : { ok: false, reason: `HTTP ${String(response.status)}` },
    ),
    Effect.orElseSucceed((error): Attempted => ({ ok: false, reason: error._tag })),
  );

/**
 * Read a peer's identity from its response body.
 *
 * A malformed body is not a probe failure — the peer ANSWERED, which is the fact
 * the caller needs; the missing identity fields simply stay absent.
 */
export const decodeIdentity = (response: HttpRes): PeerIdentity | undefined => {
  const json = Option.fromNullishOr(parseJson(new TextDecoder().decode(response.body)));
  return Option.isNone(json) ? undefined : Option.getOrUndefined(Schema.decodeUnknownOption(PeerIdentity)(json.value));
};

/** JSON.parse that reports failure as `undefined`, which `Option.fromNullishOr` turns into a `None`. */
export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const originOf = (value: string): string | undefined => {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return undefined;
  }
};
