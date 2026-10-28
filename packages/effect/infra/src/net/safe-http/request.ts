import { stripBrackets } from "../address";
import { isIpLiteral } from "../ip-policy";
import { EgressDenied, HttpFailed, ResponseTooLarge, SafeHttpError, TooManyRedirects } from "./errors";
import { EgressPolicy } from "./policy";
import { HttpReq, HttpRes, ResolvedAddress, SafeHttpOptions } from "./types";
import { checkTarget, defaultResolve, denyReason } from "./egress-check";

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class BodyTooLarge extends Error {}

/** Read a response body with a hard byte cap, cancelling the transfer the moment it is exceeded. */
export const readCapped = async (response: Response, maxBytes: number): Promise<Uint8Array> => {
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

export const execute = async (
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

export const toError = (url: string) => (cause: unknown): SafeHttpError => {
  if (cause instanceof EgressDenied || cause instanceof ResponseTooLarge || cause instanceof TooManyRedirects) return cause;
  return new HttpFailed({ url, message: cause instanceof Error ? cause.message : String(cause) });
};
