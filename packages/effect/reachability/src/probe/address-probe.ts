import { Effect } from "effect";
import { SafeHttp, toOrigin } from "@deployer/effect-infra";
import { AddressProbeResult, ProbeAddressOptions } from "./types";

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
