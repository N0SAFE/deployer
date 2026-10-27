import { afterEach, describe, expect, it, vi } from "vitest";

import {
	hostOf,
	isIpAddress,
	probeAddress,
	probePeer,
	toOrigin,
} from "./network-probe";
import type { ProbeHttp, ProbeResponse } from "./network-probe";

/**
 * These primitives decide whether an address belongs to a live process, and
 * whether a peer is reachable before a node joins its cluster. Both answers
 * gate real operations, so the details matter: which candidate is tried first,
 * whether a scheme fallback rescues a host without a certificate, and that a
 * failure is a RESULT rather than a thrown exception.
 *
 * The HTTP client is injected — no network in unit tests — so the assertions
 * describe the exact request sequence the caller depends on.
 */

type FetchArgs = [string, { readonly timeoutMs: number }];

/** The injected HTTP client of the test in progress: records calls, answers via `handler`. */
let http: ProbeHttp = () => Promise.reject(new Error("stubFetch was not called"));

function stubFetch(
	handler: (url: string, init: { readonly timeoutMs: number }) => Promise<ProbeResponse> | ProbeResponse,
): FetchArgs[] {
	const calls: FetchArgs[] = [];
	http = (url, init) => {
		calls.push([url, init]);
		return Promise.resolve().then(() => handler(url, init));
	};
	return calls;
}

function ok(body = "{}"): ProbeResponse {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve(JSON.parse(body) as unknown),
	};
}

function status(code: number): ProbeResponse {
	return {
		ok: code >= 200 && code < 300,
		status: code,
		json: () => Promise.resolve({}),
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("hostOf", () => {
	it("drops scheme, path and port", () => {
		expect(hostOf("https://example.com/base")).toBe("example.com");
		expect(hostOf("http://203.0.113.10:8080/x")).toBe("203.0.113.10");
		expect(hostOf("example.com")).toBe("example.com");
	});

	it("keeps an IPv6 host intact in both bracketed and bare forms", () => {
		expect(hostOf("http://[::1]:3005/x")).toBe("::1");
		expect(hostOf("::1")).toBe("::1");
		expect(hostOf("[2001:db8::1]:8080")).toBe("2001:db8::1");
	});

	it("tolerates an empty value", () => {
		expect(hostOf("")).toBe("");
	});
});

describe("isIpAddress", () => {
	it("detects bare IPs behind a scheme or port", () => {
		expect(isIpAddress("203.0.113.10")).toBe(true);
		expect(isIpAddress("https://203.0.113.10/x")).toBe(true);
		expect(isIpAddress("203.0.113.10:8080")).toBe(true);
	});

	it("detects IPv6 in both bracketed and bare forms", () => {
		expect(isIpAddress("::1")).toBe(true);
		expect(isIpAddress("http://[::1]:3005")).toBe(true);
		expect(isIpAddress("2001:db8::1")).toBe(true);
	});

	it("rejects hostnames", () => {
		expect(isIpAddress("example.com")).toBe(false);
		expect(isIpAddress("https://api.example.com")).toBe(false);
	});
});

describe("toOrigin", () => {
	it("preserves a caller-supplied scheme and path", () => {
		expect(toOrigin("https://example.com/base")).toBe("https://example.com/base");
	});

	it("trims trailing slashes", () => {
		expect(toOrigin("https://example.com/base/")).toBe("https://example.com/base");
	});

	it("gives a bare hostname https and a bare IP http", () => {
		expect(toOrigin("example.com")).toBe("https://example.com");
		expect(toOrigin("203.0.113.10")).toBe("http://203.0.113.10");
	});
});

describe("probeAddress", () => {
	it("returns the first path that answers 2xx", async () => {
		const calls = stubFetch((url) => (url.endsWith("/mesh/ping") ? ok() : status(500)));

		const result = await probeAddress("example.com", { http, paths: ["/mesh/ping", "/health"] });

		expect(result.valid).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(result.probeUrl).toBe("https://example.com/mesh/ping");
		expect(calls).toHaveLength(1);
	});

	it("falls through to later paths before giving up", async () => {
		const calls = stubFetch((url) => (url.endsWith("/health") ? ok() : status(503)));

		const result = await probeAddress("example.com", { http, paths: ["/mesh/ping", "/health"] });

		expect(result.valid).toBe(true);
		expect(result.probeUrl).toBe("https://example.com/health");
		expect(calls).toHaveLength(2);
	});

	it("retries over http when tryBothSchemes is set (a host with no certificate)", async () => {
		const calls = stubFetch((url) => (url.startsWith("http://") ? ok() : status(502)));

		const result = await probeAddress("example.com", {
			http,
			paths: ["/mesh/ping"],
			tryBothSchemes: true,
		});

		expect(result.valid).toBe(true);
		expect(result.probeUrl).toBe("http://example.com/mesh/ping");
		expect(calls.map(([u]) => u)).toEqual([
			"https://example.com/mesh/ping",
			"http://example.com/mesh/ping",
		]);
	});

	it("does not try the http fallback unless asked", async () => {
		const calls = stubFetch(() => status(502));

		const result = await probeAddress("example.com", { http, paths: ["/mesh/ping"] });

		expect(result.valid).toBe(false);
		expect(calls.map(([u]) => u)).toEqual(["https://example.com/mesh/ping"]);
	});

	it("reports a network error as an invalid result, never a throw", async () => {
		stubFetch(() => {
			throw new Error("ECONNREFUSED");
		});

		const result = await probeAddress("example.com", { http, paths: ["/health"] });

		expect(result.valid).toBe(false);
		expect(result.reason).toBeTruthy();
	});

	it("uses the caller's failure message so the remediation text is app-owned", async () => {
		stubFetch(() => status(500));

		const result = await probeAddress("example.com", {
			http,
			paths: ["/health"],
			failureReason: (address) => `DNS may still be propagating for ${address}`,
		});

		expect(result.reason).toBe("DNS may still be propagating for example.com");
	});

	it("rejects an empty address without touching the network", async () => {
		const calls = stubFetch(() => ok());

		const result = await probeAddress("   ", { http, paths: ["/health"] });

		expect(result.valid).toBe(false);
		expect(result.reason).toBe("Address is empty");
		expect(calls).toHaveLength(0);
	});
});

describe("probePeer", () => {
	it("returns the identity the peer reported", async () => {
		stubFetch(() =>
			ok(JSON.stringify({ advertisedHost: "10.0.0.5", version: "1.2.3", extra: "ignored" })),
		);

		const result = await probePeer("http://10.0.0.5:3005", { http, primaryPath: "/mesh/ping" });

		expect(result.reachable).toBe(true);
		expect(result.identity).toEqual({ advertisedHost: "10.0.0.5", version: "1.2.3" });
		expect(result.probeUrl).toBe("http://10.0.0.5:3005/mesh/ping");
	});

	it("normalizes the URL to its origin before probing", async () => {
		const calls = stubFetch(() => ok());

		await probePeer("http://10.0.0.5:3005/some/path?x=1", { http, primaryPath: "/mesh/ping" });

		expect(calls[0]?.[0]).toBe("http://10.0.0.5:3005/mesh/ping");
	});

	it("falls back to the liveness path when the primary answers non-2xx", async () => {
		const calls = stubFetch((url) => (url.endsWith("/health") ? ok() : status(503)));

		const result = await probePeer("http://10.0.0.5:3005", {
			http,
			primaryPath: "/mesh/ping",
			fallbackPath: "/health",
		});

		expect(result.reachable).toBe(true);
		expect(result.probeUrl).toBe("http://10.0.0.5:3005/health");
		expect(calls).toHaveLength(2);
	});

	it("reports both statuses when neither path works", async () => {
		stubFetch(() => status(503));

		const result = await probePeer("http://10.0.0.5:3005", {
			http,
			primaryPath: "/mesh/ping",
			fallbackPath: "/health",
		});

		expect(result.reachable).toBe(false);
		expect(result.error).toContain("/mesh/ping");
		expect(result.error).toContain("/health");
	});

	it("does not attempt a fallback when none was configured", async () => {
		const calls = stubFetch(() => status(503));

		const result = await probePeer("http://10.0.0.5:3005", { http, primaryPath: "/mesh/ping" });

		expect(result.reachable).toBe(false);
		expect(calls).toHaveLength(1);
	});

	it("rejects a malformed URL without touching the network", async () => {
		const calls = stubFetch(() => ok());

		const result = await probePeer("not a url", { http, primaryPath: "/mesh/ping" });

		expect(result.reachable).toBe(false);
		expect(result.error).toBe("Invalid URL format");
		expect(calls).toHaveLength(0);
	});

	it("tolerates a peer that answers 2xx with a non-JSON body", async () => {
		stubFetch(
			() =>
				({
					ok: true,
					status: 200,
					json: () => Promise.reject(new Error("invalid json")),
				}),
		);

		const result = await probePeer("http://10.0.0.5:3005", { http, primaryPath: "/mesh/ping" });

		// The probe's job is reachability; an unparseable identity is not a failure.
		expect(result.reachable).toBe(true);
		expect(result.identity).toEqual({});
	});
});

describe("probes honour the injected client's refusals", () => {
	const refuse: ProbeHttp = () => Promise.reject(new Error("Target not allowed by the network policy"));

	it("probeAddress reports a refused target as not valid, with no address in the reason", async () => {
		const result = await probeAddress("169.254.169.254", { http: refuse, paths: ["/latest/meta-data/"] });
		expect(result.valid).toBe(false);
		expect(result.reason).not.toContain("meta-data/\"");
	});

	it("probePeer reports the refusal message, not a transport detail", async () => {
		const result = await probePeer("http://169.254.169.254", { http: refuse, primaryPath: "/mesh/ping" });
		expect(result.reachable).toBe(false);
		expect(result.error).toBe("Target not allowed by the network policy");
	});

	it("probePeer asks the client with the caller's timeout and never falls back after a refusal", async () => {
		const calls = stubFetch(() => Promise.reject(new Error("Target not allowed by the network policy")));
		await probePeer("http://10.0.0.5:3005", { http, primaryPath: "/mesh/ping", fallbackPath: "/health", timeoutMs: 1234 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[1]).toEqual({ timeoutMs: 1234 });
	});
});
