import { fromAbortable } from "@deployer/effect-core";
import { Context, Data, Duration, Effect, Layer } from "effect";

import { classifyAddress, isIpLiteral, type AddressClass } from "./ip-policy";

/** The target (or a redirect hop, or a DNS answer) violates the egress policy. */
export class EgressDenied extends Data.TaggedError("EgressDenied")<{
  readonly url: string;
  readonly reason: string;
}> {}
export class HttpTimeout extends Data.TaggedError("HttpTimeout")<{
  readonly url: string;
  readonly afterMs: number;
}> {}
export class ResponseTooLarge extends Data.TaggedError("ResponseTooLarge")<{
  readonly url: string;
  readonly limitBytes: number;
}> {}
export class TooManyRedirects extends Data.TaggedError("TooManyRedirects")<{
  readonly url: string;
  readonly limit: number;
}> {}
/** Transport-level failure (connection refused, TLS error, reset, DNS failure, ...). */
export class HttpFailed extends Data.TaggedError("HttpFailed")<{
  readonly url: string;
  readonly message: string;
}> {}

export type SafeHttpError = EgressDenied | HttpTimeout | ResponseTooLarge | TooManyRedirects | HttpFailed;

export type EgressPolicy = {
  readonly schemes: readonly ("http" | "https")[];
  /** Exact host (`api.github.com`) or suffix wildcard (`*.example.com`). Empty/undefined = any host the other rules allow. */
  readonly allowHosts?: readonly string[];
  /** Deny loopback, private, link-local, CGNAT, unspecified, multicast and reserved ranges. */
  readonly denyPrivate: boolean;
  /** Deny cloud metadata addresses even when `denyPrivate` is false. */
  readonly denyMetadata: boolean;
  /**
   * When set, EXACTLY these address classes are denied, replacing the all-or-nothing `denyPrivate`.
   * It lets a policy accept private LAN peers while still refusing loopback and link-local.
   */
  readonly denyClasses?: readonly AddressClass[];
  readonly timeout: Duration.Input;
  readonly maxBytes: number;
  /** Maximum redirect hops; each hop is re-validated. 0 disables following. */
  readonly followRedirects: number;
};

export const EgressPolicy = {
  /** Targets a user or tenant controls (webhook URLs, git URLs, domain checks, probes). */
  userSupplied: {
    schemes: ["https", "http"],
    denyPrivate: true,
    denyMetadata: true,
    timeout: Duration.seconds(10),
    maxBytes: 5 * 1024 * 1024,
    followRedirects: 3,
  },
  /**
   * A target an OPERATOR typed (a mesh peer, a node's address): private LAN ranges are normal
   * (home labs), but loopback, link-local, unspecified, multicast and reserved ranges are not,
   * and cloud metadata never. No redirects: a peer has no business redirecting a probe.
   */
  operatorTarget: {
    schemes: ["http", "https"],
    denyPrivate: false,
    denyClasses: ["loopback", "link-local", "unspecified", "multicast", "reserved"],
    denyMetadata: true,
    timeout: Duration.seconds(5),
    maxBytes: 1024 * 1024,
    followRedirects: 0,
  },
  /** Sibling platform services on the private network: private ranges allowed, metadata still denied. */
  internal: {
    schemes: ["http", "https"],
    denyPrivate: false,
    denyMetadata: true,
    timeout: Duration.seconds(10),
    maxBytes: 5 * 1024 * 1024,
    followRedirects: 0,
  },
} as const satisfies Record<string, EgressPolicy>;

export type HttpReq = {
  readonly method?: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
};

export type HttpRes = {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** The final URL after redirects. */
  readonly url: string;
};

export type SafeHttpShape = {
  readonly request: (req: HttpReq, policy: EgressPolicy) => Effect.Effect<HttpRes, SafeHttpError>;
};

export type ResolvedAddress = { readonly address: string };

export type SafeHttpOptions = {
  /** Name resolution. Defaults to `Bun.dns.lookup`; injectable so specs and split-horizon setups need no real DNS. */
  readonly resolve?: (host: string) => Promise<readonly ResolvedAddress[]>;
  /** Extra CA certificate(s) (PEM) trusted for https, e.g. an internal platform CA. */
  readonly ca?: string | readonly string[];
};

const defaultResolve = async (host: string): Promise<readonly ResolvedAddress[]> =>
  (await Bun.dns.lookup(host)).map(({ address }) => ({ address }));

const DENIED_BY_POLICY: ReadonlySet<AddressClass> = new Set<AddressClass>([
  "loopback",
  "private",
  "link-local",
  "cgnat",
  "unspecified",
  "multicast",
  "reserved",
]);

/** Returns the reason an address is refused under the policy, or `undefined` when it is allowed. */
const denyReason = (address: string, policy: EgressPolicy): string | undefined => {
  const klass = classifyAddress(address);
  if (klass === "invalid") return `unparseable address ${address}`;
  if (klass === "metadata" && (policy.denyMetadata || (policy.denyClasses === undefined && policy.denyPrivate))) {
    return `metadata address ${address}`;
  }
  if (policy.denyClasses !== undefined) {
    return policy.denyClasses.includes(klass) ? `${klass} address ${address}` : undefined;
  }
  if (policy.denyPrivate && DENIED_BY_POLICY.has(klass)) return `${klass} address ${address}`;
  return undefined;
};

const hostAllowed = (host: string, allow: EgressPolicy["allowHosts"]): boolean => {
  if (allow === undefined || allow.length === 0) return true;
  const h = host.toLowerCase();
  return allow.some((entry) => {
    const e = entry.toLowerCase();
    return e.startsWith("*.") ? h.endsWith(e.slice(1)) && h.length > e.length - 1 : h === e;
  });
};

const stripBrackets = (host: string): string => host.replace(/^\[|\]$/g, "");

/** Validate scheme, host allow-list and credentials. Addresses are validated after resolution. */
const checkTarget = (url: URL, policy: EgressPolicy): EgressDenied | undefined => {
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme !== "http" && scheme !== "https") return new EgressDenied({ url: url.href, reason: `scheme ${scheme} not allowed` });
  if (!policy.schemes.includes(scheme)) return new EgressDenied({ url: url.href, reason: `scheme ${scheme} not allowed` });
  if (url.username !== "" || url.password !== "") return new EgressDenied({ url: url.href, reason: "credentials in URL" });
  const host = stripBrackets(url.hostname);
  if (!hostAllowed(host, policy.allowHosts)) return new EgressDenied({ url: url.href, reason: `host ${host} not in allow-list` });
  return undefined;
};

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class BodyTooLarge extends Error {}

/** Read a response body with a hard byte cap, cancelling the transfer the moment it is exceeded. */
const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BodyTooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const execute = async (
  req: HttpReq,
  policy: EgressPolicy,
  signal: AbortSignal,
  options: SafeHttpOptions,
): Promise<HttpRes> => {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    throw new EgressDenied({ url: req.url, reason: "invalid URL" });
  }
  const resolve = options.resolve ?? defaultResolve;
  let method = (req.method ?? "GET").toUpperCase();
  let body = req.body;
  let headers: Record<string, string> = { ...(req.headers ?? {}) };

  for (let redirects = 0; ; redirects++) {
    const denied = checkTarget(url, policy);
    if (denied !== undefined) throw denied;

    // Resolve ONCE, validate EVERY answer, then connect to that exact address (no resolve-then-connect gap).
    const host = stripBrackets(url.hostname);
    const literal = isIpLiteral(host);
    const answers: readonly ResolvedAddress[] = literal ? [{ address: host }] : await resolve(host);
    const [first] = answers;
    if (first === undefined) throw new Error(`no addresses for ${host}`);
    for (const { address } of answers) {
      const reason = denyReason(address, policy);
      if (reason !== undefined) throw new EgressDenied({ url: url.href, reason });
    }
    const pinnedAddress = first.address;

    const pinned = new URL(url);
    pinned.hostname = pinnedAddress.includes(":") ? `[${pinnedAddress}]` : pinnedAddress;

    const response = await fetch(pinned, {
      method,
      // The pinned URL carries the IP; the original authority travels as Host (and SNI for https).
      headers: { ...headers, Host: url.host },
      ...(body === undefined ? {} : { body }),
      redirect: "manual", // every hop is validated here, never inside fetch
      signal,
      proxy: false, // a proxy would resolve and connect on our behalf and bypass the address checks
      keepalive: false,
      ...(url.protocol === "https:"
        ? { tls: { ...(literal ? {} : { serverName: host }), ...(options.ca === undefined ? {} : { ca: [...(typeof options.ca === "string" ? [options.ca] : options.ca)] }) } }
        : {}),
    });

    const location = response.headers.get("location");
    if (REDIRECT_STATUSES.has(response.status) && location !== null) {
      await response.body?.cancel();
      if (redirects >= policy.followRedirects) throw new TooManyRedirects({ url: url.href, limit: policy.followRedirects });
      const next = new URL(location, url);
      // A cross-origin hop must not carry credentials; 301/302 POST and 303 downgrade to GET without a body.
      if (next.origin !== url.origin) {
        headers = Object.fromEntries(
          Object.entries(headers).filter(([k]) => !/^(authorization|cookie|proxy-authorization)$/i.test(k)),
        );
      }
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      url = next;
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await readCapped(response, policy.maxBytes);
    } catch (error) {
      if (error instanceof BodyTooLarge) throw new ResponseTooLarge({ url: url.href, limitBytes: policy.maxBytes });
      throw error;
    }
    const flat: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      flat[key] = value;
    });
    // `forEach` yields one entry per Set-Cookie and the loop above keeps only the last; callers
    // that read a session cookie need all of them, joined the way `Headers.get` joins them.
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) flat["set-cookie"] = cookies.join(", ");
    return { status: response.status, headers: flat, body: bytes, url: url.href };
  }
};

const toError = (url: string) => (cause: unknown): SafeHttpError => {
  if (cause instanceof EgressDenied || cause instanceof ResponseTooLarge || cause instanceof TooManyRedirects) return cause;
  return new HttpFailed({ url, message: cause instanceof Error ? cause.message : String(cause) });
};

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
          fromAbortable((signal) => execute(req, policy, signal, options), toError(req.url)).pipe(
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
