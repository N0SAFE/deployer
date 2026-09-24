/**
 * Network probing primitives — the CORE FUNCTIONALITY of this package.
 *
 * These are generic network operations: normalize an address, probe whether
 * something is alive at it, ask a peer to identify itself. None of them knows
 * what a "node" is, where a `node_network_config` row lives, or what this
 * platform's reachability POLICY is. They take an address and answer a question
 * about it.
 *
 * WHY THESE TWO AND NOT MORE
 * Exactly two operations are consumed by BOTH apps: the setup wizard probes a
 * mesh URL before joining a cluster, and verifies a public address before
 * saving it. Everything else in the app's reachability module is a platform
 * rule or an app-only feature; moving it here would publish a contract no
 * second app honours.
 */

import { isIP } from "node:net";

/**
 * Split an address into its bare host, dropping scheme, path and port.
 *
 * IPv6 is handled explicitly: a URL carries it bracketed (`http://[::1]:3005`),
 * and a bare address contains several colons. Splitting on the first colon
 * would silently mangle both into an empty host — so `isIpAddress` would then
 * report a valid IPv6 address as a hostname.
 */
export function hostOf(value: string): string {
	const withoutScheme = value.replace(/^https?:\/\//i, "");
	const withoutPath = withoutScheme.split("/")[0] ?? "";

	// URL form: the host is inside the brackets.
	const bracketed = /^\[([^\]]+)\]/.exec(withoutPath);
	if (bracketed?.[1] !== undefined) return bracketed[1];

	// Bare IPv6 (more than one colon) — the whole value is the host.
	if (withoutPath.split(":").length > 2) return withoutPath;

	// IPv4 or hostname, optionally followed by `:port`.
	return withoutPath.split(":")[0] ?? "";
}

/** Whether an address is a bare IP (as opposed to a hostname). */
export function isIpAddress(value: string): boolean {
	return isIP(hostOf(value)) !== 0;
}

/**
 * Normalize an address to a full origin.
 *
 * The caller's scheme and path are PRESERVED when given
 * (`https://example.com/base` stays intact); a bare hostname gains `https` and a
 * bare IP gains `http`.
 */
export function toOrigin(value: string): string {
	const clean = value.trim().replace(/\/+$/, "");
	if (/^https?:\/\//i.test(clean)) return clean;
	return isIpAddress(clean) ? `http://${clean}` : `https://${clean}`;
}

/** The outcome of probing whether an address belongs to a live process. */
export interface AddressProbeResult {
	readonly valid: boolean;
	readonly reason?: string;
	readonly latencyMs?: number;
	readonly statusCode?: number;
	/** The probe URL that succeeded, when one did. */
	readonly probeUrl?: string;
}

/** Options for {@link probeAddress}. */
export interface ProbeAddressOptions {
	/** Paths to try, in order, appended to the normalized origin. */
	readonly paths: readonly string[];
	/** Per-probe timeout (ms). */
	readonly timeoutMs?: number;
	/**
	 * Also retry each path over the other scheme (`https`→`http`).
	 *
	 * A node that has not obtained a certificate yet still answers plainly on
	 * `http`; treating that as "down" would misreport a healthy host.
	 */
	readonly tryBothSchemes?: boolean;
	/** Failure message builder, so the caller controls the remediation text. */
	readonly failureReason?: (address: string) => string;
}

/**
 * Probe an address until one of the given paths answers 2xx.
 *
 * The CALLER decides which paths to try and what a failure means — those are
 * the policy this package does not own.
 *
 * Never throws: a probe failure is a RESULT, because "the address is not
 * reachable" is a legitimate answer rather than an error in the caller.
 */
export async function probeAddress(
	address: string,
	options: ProbeAddressOptions,
): Promise<AddressProbeResult> {
	const clean = address.trim().replace(/\/+$/, "");
	if (!clean) return { valid: false, reason: "Address is empty" };

	const origin = toOrigin(clean);
	const timeoutMs = options.timeoutMs ?? 5_000;

	const candidates: string[] = [];
	for (const path of options.paths) {
		const url = `${origin}${path}`;
		candidates.push(url);
		if (options.tryBothSchemes) {
			candidates.push(url.replace(/^https:/, "http:"));
		}
	}

	for (const url of candidates) {
		try {
			const start = Date.now();
			const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (response.ok) {
				return {
					valid: true,
					latencyMs: Date.now() - start,
					statusCode: response.status,
					probeUrl: url,
				};
			}
		} catch {
			// try the next candidate
		}
	}

	return {
		valid: false,
		reason:
			options.failureReason?.(clean) ??
			`Address "${clean}" did not respond on ${options.paths.join(" or ")}.`,
	};
}

/** The identity a peer's probe endpoint may report back. */
export interface PeerIdentity {
	readonly advertisedHost?: string;
	readonly version?: string;
}

/** The outcome of probing another node's identity endpoint. */
export interface PeerProbeResult {
	readonly url: string;
	readonly reachable: boolean;
	/** The URL that actually answered (the primary path, or the fallback). */
	readonly probeUrl: string;
	readonly latencyMs: number;
	readonly identity?: PeerIdentity;
	readonly error?: string;
}

/** Options for {@link probePeer}. */
export interface PeerProbeOptions {
	/** Primary path, e.g. `/mesh/ping`. */
	readonly primaryPath: string;
	/**
	 * Fallback path used when the primary answers non-2xx.
	 *
	 * A node that has not finished booting may expose only its always-on
	 * liveness route; without the fallback the caller cannot distinguish "the
	 * host is a live peer" from "nothing is listening".
	 */
	readonly fallbackPath?: string;
	/** Per-attempt timeout (ms). */
	readonly timeoutMs?: number;
}

/**
 * Probe a peer's identity endpoint, with an optional liveness fallback.
 *
 * Returns the identity the peer reported when available, so the caller learns
 * the URL to dial back without a second round trip.
 *
 * Never throws — an unreachable peer is a RESULT, not an exception.
 */
export async function probePeer(url: string, options: PeerProbeOptions): Promise<PeerProbeResult> {
	let origin: string;
	try {
		origin = new URL(url.trim()).origin;
	} catch {
		return { url, reachable: false, probeUrl: url, latencyMs: 0, error: "Invalid URL format" };
	}

	const timeoutMs = options.timeoutMs ?? 5_000;
	const start = Date.now();
	const primaryUrl = `${origin}${options.primaryPath}`;

	try {
		const response = await fetch(primaryUrl, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
		const latencyMs = Date.now() - start;

		if (response.ok) {
			const json: unknown = await response.json().catch(() => ({}));
			const record =
				json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
			const advertisedHost = record.advertisedHost;
			const version = record.version;
			return {
				url,
				reachable: true,
				probeUrl: primaryUrl,
				latencyMs,
				identity: {
					advertisedHost:
						typeof advertisedHost === "string" && advertisedHost.length > 0
							? advertisedHost
							: undefined,
					version: typeof version === "string" ? version : undefined,
				},
			};
		}

		if (options.fallbackPath === undefined) {
			return {
				url,
				reachable: false,
				probeUrl: primaryUrl,
				latencyMs,
				error: `HTTP ${String(response.status)}`,
			};
		}

		const fallbackUrl = `${origin}${options.fallbackPath}`;
		const fallback = await fetch(fallbackUrl, {
			method: "GET",
			signal: AbortSignal.timeout(timeoutMs),
		});
		const fallbackLatency = Date.now() - start;

		if (fallback.ok) {
			return { url, reachable: true, probeUrl: fallbackUrl, latencyMs: fallbackLatency };
		}
		return {
			url,
			reachable: false,
			probeUrl: primaryUrl,
			latencyMs: fallbackLatency,
			error: `HTTP ${String(response.status)} (${options.primaryPath}), HTTP ${String(fallback.status)} (${options.fallbackPath})`,
		};
	} catch (error: unknown) {
		return {
			url,
			reachable: false,
			probeUrl: primaryUrl,
			latencyMs: Date.now() - start,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
