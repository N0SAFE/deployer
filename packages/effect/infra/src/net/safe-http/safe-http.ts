import { Context, Duration, Effect, Layer } from "effect";

import { stripBrackets } from "../address";
import { isIpLiteral } from "../ip-policy";

import { checkTarget, denyReason } from "./egress-check";
import { EgressDenied, HttpTimeout, SafeHttpError } from "./errors";
import { request } from "./request";
import { HttpReq, HttpRes, SafeHttpOptions, SafeHttpShape } from "./types";

/**
 * Outbound HTTP for targets the caller does not fully control, on Bun builtins
 * (`Bun.dns.lookup` + `fetch`). Enforces: scheme and host allow-lists, no credentials
 * in the URL, **resolve once, validate every answer, connect to that address**
 * (rebinding-safe: the URL is rewritten to the validated IP, the original authority
 * travels as `Host`/SNI so TLS still verifies the real name), per-hop redirect
 * re-validation (`redirect: "manual"`), a response size cap, a hard timeout, and no
 * proxy. Replaces raw `fetch` on user-influenced URLs (SEC-013, NET-004).
 */
export class SafeHttp extends Context.Service<SafeHttp, SafeHttpShape>()("infra/SafeHttp") {
  static readonly layerWith = (options: SafeHttpOptions): Layer.Layer<SafeHttp> =>
    Layer.succeed(
      SafeHttp,
      SafeHttp.of({
        request: (req, policy) =>
          request(req, policy, options).pipe(
            Effect.timeoutOrElse({
              duration: policy.timeout,
              orElse: () => Effect.fail(new HttpTimeout({ url: req.url, afterMs: Duration.toMillis(policy.timeout) })),
            }),
          ),
      }),
    );

  static readonly layer: Layer.Layer<SafeHttp> = SafeHttp.layerWith({});

  /**
   * Test double: answers from `handler`, still applying scheme/host/IP-literal policy
   * to the request URL so specs notice a forbidden target. No network is touched.
   */
  static readonly fake = (
    handler: (req: HttpReq) => HttpRes | Effect.Effect<HttpRes, SafeHttpError>,
  ): { readonly layer: Layer.Layer<SafeHttp>; readonly calls: HttpReq[] } => {
    const calls: HttpReq[] = [];
    const request: SafeHttpShape["request"] = (req, policy) =>
      Effect.suspend(() => {
        calls.push(req);
        let url: URL;
        try {
          url = new URL(req.url);
        } catch {
          return Effect.fail(new EgressDenied({ url: req.url, reason: "invalid URL" }));
        }
        const denied = checkTarget(url, policy);
        if (denied !== undefined) return Effect.fail(denied);
        const host = stripBrackets(url.hostname);
        if (isIpLiteral(host)) {
          const reason = denyReason(host, policy);
          if (reason !== undefined) return Effect.fail(new EgressDenied({ url: url.href, reason }));
        }
        const answer = handler(req);
        return Effect.isEffect(answer) ? answer : Effect.succeed(answer);
      });
    return { layer: Layer.succeed(SafeHttp, SafeHttp.of({ request })), calls };
  };
}
