import { Effect } from "effect";

import { stripBrackets } from "../address";
import { isIpLiteral } from "../ip-policy";
import { readCapped } from "./body";
import { checkTarget, defaultResolve, denyReason } from "./egress-check";
import { EgressDenied, HttpFailed, TooManyRedirects, type SafeHttpError } from "./errors";
import type { EgressPolicy } from "./policy";
import type { HttpReq, HttpRes, ResolvedAddress, SafeHttpOptions } from "./types";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_STRIPPED_HEADERS = /^(authorization|cookie|proxy-authorization)$/i;

const failed = (url: string) => (cause: unknown) =>
  new HttpFailed({ url, message: cause instanceof Error ? cause.message : String(cause) });

const parseUrl = (raw: string) =>
  Effect.try({ try: () => new URL(raw), catch: () => new EgressDenied({ url: raw, reason: "invalid URL" }) });

/** Response headers as a plain record; every `Set-Cookie` is kept, joined as `Headers.get` joins them. */
const flattenHeaders = (headers: Headers): Record<string, string> => {
  const flat: Record<string, string> = {};
  headers.forEach((value, key) => {
    flat[key] = value;
  });
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) flat["set-cookie"] = cookies.join(", ");
  return flat;
};

/**
 * Resolves the host once and validates every answer. The caller connects to the first validated
 * address, so there is no gap between resolving and connecting for a rebinding attack to use.
 */
const resolveValidated = (url: URL, policy: EgressPolicy, options: SafeHttpOptions) =>
  Effect.gen(function* () {
    const host = stripBrackets(url.hostname);
    const literal = isIpLiteral(host);
    const resolve = options.resolve ?? defaultResolve;
    const answers: readonly ResolvedAddress[] = literal
      ? [{ address: host }]
      : yield* Effect.tryPromise({ try: () => resolve(host), catch: failed(url.href) });
    const [first] = answers;
    if (first === undefined) return yield* Effect.fail(new HttpFailed({ url: url.href, message: `no addresses for ${host}` }));
    for (const { address } of answers) {
      const reason = denyReason(address, policy);
      if (reason !== undefined) return yield* Effect.fail(new EgressDenied({ url: url.href, reason }));
    }
    return { host, literal, address: first.address };
  });

/**
 * Performs the request and follows redirects by hand, validating every hop against the policy.
 * Interrupting the effect (the timeout, a cancelled caller) aborts the transfer in flight.
 */
export const request = (
  req: HttpReq,
  policy: EgressPolicy,
  options: SafeHttpOptions,
): Effect.Effect<HttpRes, SafeHttpError> =>
  Effect.gen(function* () {
    let url = yield* parseUrl(req.url);
    let method = (req.method ?? "GET").toUpperCase();
    let body = req.body;
    let headers: Record<string, string> = { ...(req.headers ?? {}) };

    for (let redirects = 0; ; redirects++) {
      const denied = checkTarget(url, policy);
      if (denied !== undefined) return yield* Effect.fail(denied);

      const { host, literal, address } = yield* resolveValidated(url, policy, options);
      const pinned = new URL(url);
      pinned.hostname = address.includes(":") ? `[${address}]` : address;
      const hop = url;

      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(pinned, {
            method,
            // The pinned URL carries the IP; the original authority travels as Host (and SNI for https).
            headers: { ...headers, Host: hop.host },
            ...(body === undefined ? {} : { body }),
            redirect: "manual", // every hop is validated here, never inside fetch
            signal,
            proxy: false, // a proxy would resolve and connect on our behalf and bypass the address checks
            keepalive: false,
            ...(hop.protocol === "https:"
              ? {
                  tls: {
                    ...(literal ? {} : { serverName: host }),
                    ...(options.ca === undefined ? {} : { ca: typeof options.ca === "string" ? [options.ca] : [...options.ca] }),
                  },
                }
              : {}),
          }),
        catch: failed(hop.href),
      });

      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location !== null) {
        yield* Effect.tryPromise({ try: async () => response.body?.cancel(), catch: failed(hop.href) }).pipe(Effect.ignore);
        if (redirects >= policy.followRedirects) {
          return yield* Effect.fail(new TooManyRedirects({ url: hop.href, limit: policy.followRedirects }));
        }
        const next = yield* parseUrl(new URL(location, hop).href);
        // A cross-origin hop must not carry credentials; 301/302 POST and 303 become a bodiless GET.
        if (next.origin !== hop.origin) {
          headers = Object.fromEntries(Object.entries(headers).filter(([key]) => !CROSS_ORIGIN_STRIPPED_HEADERS.test(key)));
        }
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
        }
        url = next;
        continue;
      }

      const bytes = yield* readCapped(response, hop.href, policy.maxBytes);
      return { status: response.status, headers: flattenHeaders(response.headers), body: bytes, url: hop.href };
    }
  });
