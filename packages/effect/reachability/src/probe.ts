import { Effect, Option, Schema } from "effect";
import {
  SafeHttp,
  toOrigin,
  type EgressPolicy,
  type HttpRes,
  type SafeHttpShape,
} from "@deployer/effect-infra";

/**
 * Probing: "is something alive at this address, and is it what I expect?"
 *
 * No transport code lives here. Timeouts, redirect limits, response size caps, DNS
 * pinning and the address policy all come from `@deployer/effect-infra`'s
 * `SafeHttp`; this module only decides WHICH urls to ask and HOW to read the answer.
 * The caller supplies the `EgressPolicy`, because what a probe may reach is the
 * app's rule, not this package's.
 */

/** What a peer reports about itself at its identity endpoint. */
export class PeerIdentity extends Schema.Class<PeerIdentity>("reachability/PeerIdentity")({
  advertisedHost: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
}) {}

/** The outcome of probing an address for a live service. */
export type AddressProbeResult = {
  readonly valid: boolean;
  readonly reason?: string;
  readonly latencyMs?: number;
  readonly statusCode?: number;
  /** The probe URL that answered, when one did. */
  readonly probeUrl?: string;
};

export type ProbeAddressOptions = {
  /** Which egress policy the probes run under (what they may reach). */
  readonly policy: EgressPolicy;
  /** Paths to try, in order, appended to the normalized origin. */
  readonly paths: readonly string[];
  /**
   * Also try each path over the other scheme (`https`→`http`).
   *
   * A node that has not obtained its certificate yet still answers plainly on
   * `http`; treating that as "down" would misreport a healthy host.
   */
  readonly tryBothSchemes?: boolean;
  /** Failure message builder, so the caller owns the remediation text. */
  readonly failureReason?: (address: string) => string;
};

/** The outcome of probing a peer's identity endpoint. */
export type PeerProbeResult = {
  readonly url: string;
  readonly reachable: boolean;
  readonly probeUrl: string;
  readonly latencyMs: number;
  readonly identity?: PeerIdentity;
  readonly error?: string;
};

export type ProbePeerOptions = {
  readonly policy: EgressPolicy;
  /** Primary path, e.g. `/mesh/ping`. */
  readonly primaryPath: string;
  /**
   * Path used when the primary answers non-2xx.
   *
   * A node that has not finished booting may expose only its always-on liveness
   * route; without the fallback, "nothing is listening" and "the peer is alive but
   * not ready" are indistinguishable.
   */
  readonly fallbackPath?: string;
};

/**
 * Probe an address until one of `paths` answers 2xx.
 *
 * Never fails: "the address is not reachable" is a legitimate answer, and every
 * `SafeHttp` refusal (denied target, timeout, oversized response, transport error)
 * is a reason the caller reports. The reason never carries a resolved address —
 * `publicEgressMessage` already guarantees that for the detail.
 */
export const probeAddress = (
  address: string,
  options: ProbeAddressOptions,
): Effect.Effect<AddressProbeResult, never, SafeHttp> =>
  Effect.gen(function* () {
    const clean = address.trim().replace(/\/+$/, "");
    if (clean === "") return { valid: false, reason: "Address is empty" };

    const origin = toOrigin(clean);
    const candidates = options.paths.flatMap((path) => {
      const url = `${origin}${path}`;
      return options.tryBothSchemes ? [url, url.replace(/^https:/, "http:")] : [url];
    });

    const http = yield* SafeHttp;

    // `firstSuccessOf` gives "try in order, keep the first success" without
    // building a result array and searching it afterwards.
    return yield* Effect.firstSuccessOf(
      candidates.map((url) =>
        Effect.gen(function* () {
          const startedAt = performance.now();
          const response = yield* http.request({ url }, options.policy);
          if (response.status < 200 || response.status >= 300) {
            // A non-2xx is a miss, not a stop: the next candidate may answer.
            return yield* Effect.fail(response.status);
          }
          return {
            valid: true,
            latencyMs: Math.round(performance.now() - startedAt),
            statusCode: response.status,
            probeUrl: url,
          } satisfies AddressProbeResult;
        }),
      ),
    ).pipe(
      Effect.orElseSucceed(
        (): AddressProbeResult => ({
          valid: false,
          reason:
            options.failureReason?.(clean) ??
            `Address "${clean}" did not respond on ${options.paths.join(" or ")}.`,
        }),
      ),
    );
  });

/**
 * Probe a peer's identity endpoint, with an optional liveness fallback.
 *
 * Returns the identity the peer reported, so the caller learns the URL to dial
 * back without a second round trip. Never fails, for the same reason as
 * {@link probeAddress}.
 */
export const probePeer = (
  url: string,
  options: ProbePeerOptions,
): Effect.Effect<PeerProbeResult, never, SafeHttp> =>
  Effect.gen(function* () {
    const origin = originOf(url);
    if (origin === undefined) {
      return { url, reachable: false, probeUrl: url, latencyMs: 0, error: "Invalid URL format" };
    }

    const http = yield* SafeHttp;
    const primaryUrl = `${origin}${options.primaryPath}`;
    const startedAt = performance.now();

    const primary = yield* requestOrReason(http, primaryUrl, options.policy);
    const primaryLatency = Math.round(performance.now() - startedAt);

    if (primary.ok) {
      return {
        url,
        reachable: true,
        probeUrl: primaryUrl,
        latencyMs: primaryLatency,
        identity: decodeIdentity(primary.response),
      } satisfies PeerProbeResult;
    }

    if (options.fallbackPath === undefined) {
      return {
        url,
        reachable: false,
        probeUrl: primaryUrl,
        latencyMs: primaryLatency,
        error: primary.reason,
      } satisfies PeerProbeResult;
    }

    const fallbackUrl = `${origin}${options.fallbackPath}`;
    const fallback = yield* requestOrReason(http, fallbackUrl, options.policy);
    const latencyMs = Math.round(performance.now() - startedAt);

    return fallback.ok
      ? { url, reachable: true, probeUrl: fallbackUrl, latencyMs }
      : {
          url,
          reachable: false,
          probeUrl: primaryUrl,
          latencyMs,
          error: `${primary.reason} (${options.primaryPath}), ${fallback.reason} (${options.fallbackPath})`,
        };
  });

type Attempted = { readonly ok: true; readonly response: HttpRes } | { readonly ok: false; readonly reason: string };

/**
 * One request, collapsed to "answered 2xx with this response" or "here is why not".
 *
 * Collapsing is the point: `probePeer` reports either way, so a refused egress, a
 * 503 and a reset connection all have to become the same shape.
 */
const requestOrReason = (
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
const decodeIdentity = (response: HttpRes): PeerIdentity | undefined => {
  const json = Option.fromNullishOr(parseJson(new TextDecoder().decode(response.body)));
  return Option.isNone(json) ? undefined : Option.getOrUndefined(Schema.decodeUnknownOption(PeerIdentity)(json.value));
};

/** JSON.parse that reports failure as `undefined`, which `Option.fromNullishOr` turns into a `None`. */
const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const originOf = (value: string): string | undefined => {
  try {
    return new URL(value.trim()).origin;
  } catch {
    return undefined;
  }
};
