import { isIpLiteral } from "./ip-policy";

/**
 * Address handling — `URL` and `net` do the parsing; this file only covers the two
 * places where they disagree with an address an operator actually types.
 *
 * Everything here is a one-liner over a builtin on purpose. A hand-written splitter
 * gets IPv6 wrong (`::1` has three colons and no port), and a hand-written literal
 * check drifts from `ip-policy`'s. If `URL` can answer, `URL` answers.
 */

/** `URL.hostname` keeps IPv6 brackets (`[::1]`); the policy classifier does not accept them. */
export const stripBrackets = (host: string): string => host.replace(/^\[|\]$/g, "");

/**
 * The bare host of an address: scheme, port and path dropped, IPv6 brackets kept.
 *
 * A bare IPv6 literal is the one input `URL` refuses — it reads `::1` as an empty
 * host with a malformed port — so it is recognised first. Bracketing it would also
 * work, but then `[::1]:3005` and `::1` would take different code paths for no
 * reason.
 */
export const hostOf = (value: string): string => {
    const trimmed = value.trim();
    if (isIpLiteral(trimmed)) return trimmed;

    try {
        return new URL(hasHttpScheme(trimmed) ? trimmed : `http://${trimmed}`).hostname;
    } catch {
        // Not an address at all (empty, or something like `:::x`). "No host" is the
        // honest answer; the caller decides whether that is a failure.
        return "";
    }
};

/** Whether an address is a bare IP rather than a hostname. */
export const isIpAddress = (value: string): boolean => isIpLiteral(hostOf(value));

/**
 * The origin of an address: the scheme and port kept, the path dropped.
 *
 * A bare hostname gains `https` — the only scheme worth guessing for a name. A bare
 * IP gains `http`, because nothing can hold a certificate for it.
 */
export const toOrigin = (value: string): string => {
    const trimmed = value.trim();
    if (hasHttpScheme(trimmed)) {
        try {
            return new URL(trimmed).origin;
        } catch {
            return "";
        }
    }

    const host = hostOf(trimmed);
    if (host === "") return "";

    const authority = isIpLiteral(stripBrackets(host)) && !host.startsWith("[") ? `[${host}]` : host;
    return `${isIpAddress(host) ? "http" : "https"}://${authority}`;
};

const hasHttpScheme = (value: string): boolean => /^https?:\/\//i.test(value);
