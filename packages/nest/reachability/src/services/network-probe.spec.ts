import { afterEach, describe, expect, it, vi } from "vitest";

import {
	hostOf,
	isIpAddress,
	probeAddress,
	probePeer,
	toOrigin,
} from "./network-probe";

/**
 * These primitives decide whether an address belongs to a live process, and
 * whether a peer is reachable before a node joins its cluster. Both answers
 * gate real operations, so the details matter: which candidate is tried first,
 * whether a scheme fallback rescues a host without a certificate, and that a
 * failure is a RESULT rather than a thrown exception.
 *
 * `fetch` is stubbed globally — no network in unit tests — so the assertions
 * describe the exact request sequence the caller depends on.
 */

type FetchArgs = [string, RequestInit | undefined];

function stubFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): FetchArgs[] {
	const calls: FetchArgs[] = [];
	vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
		calls.push([url, init]);
		return Promise.resolve().then(() => handler(url, init));
	});
	return calls;
}

function ok(body = "{}"): Response {
	return {
		ok: true,
		status: 200,
		text: () => Promise.resolve(body),
		json: () => Promise.resolve(JSON.parse(body) as unknown),
	} as unknown as Response;
}

function status(code: number): Response {
	return {
		ok: code >= 200 && code < 300,
		status: code,
		text: () => Promise.resolve(""),
		json: () => Promise.resolve({}),
	} as unknown as Response;
}

afterEach(() => {
	vi.unstubAllGlobals();
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

		const result = await probeAddress("example.com", { paths: ["/mesh/ping", "/health"] });

		expect(result.valid).toBe(true);
		expect(result.statusCode).toBe(200);
		expect(result.probeUrl).toBe("https://example.com/mesh/ping");
		expect(calls).toHaveLength(1);
	});

	it("falls through to later paths before giving up", async () => {
		const calls = stubFetch((url) => (url.endsWith("/health") ? ok() : status(503)));

		const result = await probeAddress("example.com", { paths: ["/mesh/ping", "/health"] });

		expect(result.valid).toBe(true);
		expect(result.probeUrl).toBe("https://example.com/health");
		expect(calls).toHaveLength(2);
	});

	it("retries over http when tryBothSchemes is set (a host with no certificate)", async () => {
		const calls = stubFetch((url) => (url.startsWith("http://") ? ok() : status(502)));

		const result = await probeAddress("example.com", {
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

		const result = await probeAddress("example.com", { paths: ["/mesh/ping"] });

		expect(result.valid).toBe(false);
		expect(calls.map(([u]) => u)).toEqual(["https://example.com/mesh/ping"]);
	});

	it("reports a network error as an invalid result, never a throw", async () => {
		stubFetch(() => {
			throw new Error("ECONNREFUSED");
		});

		const result = await probeAddress("example.com", { paths: ["/health"] });

		expect(result.valid).toBe(false);
		expect(result.reason).toBeTruthy();
	});

	it("uses the caller's failure message so the remediation text is app-owned", async () => {
		stubFetch(() => status(500));

		const result = await probeAddress("example.com", {
			paths: ["/health"],
			failureReason: (address) => `DNS may still be propagating for ${address}`,
		});

		expect(result.reason).toBe("DNS may still be propagating for example.com");
	});

	it("rejects an empty address without touching the network", async () => {
		const calls = stubFetch(() => ok());

		const result = await probeAddress("   ", { paths: ["/health"] });

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

		const result = await probePeer("http://10.0.0.5:3005", { primaryPath: "/mesh/ping" });

		expect(result.reachable).toBe(true);
		expect(result.identity).toEqual({ advertisedHost: "10.0.0.5", version: "1.2.3" });
		expect(result.probeUrl).toBe("http://10.0.0.5:3005/mesh/ping");
	});

	it("normalizes the URL to its origin before probing", async () => {
		const calls = stubFetch(() => ok());

		await probePeer("http://10.0.0.5:3005/some/path?x=1", { primaryPath: "/mesh/ping" });

		expect(calls[0]?.[0]).toBe("http://10.0.0.5:3005/mesh/ping");
	});

	it("falls back to the liveness path when the primary answers non-2xx", async () => {
		const calls = stubFetch((url) => (url.endsWith("/health") ? ok() : status(503)));

		const result = await probePeer("http://10.0.0.5:3005", {
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
			primaryPath: "/mesh/ping",
			fallbackPath: "/health",
		});

		expect(result.reachable).toBe(false);
		expect(result.error).toContain("/mesh/ping");
		expect(result.error).toContain("/health");
	});

	it("does not attempt a fallback when none was configured", async () => {
		const calls = stubFetch(() => status(503));

		const result = await probePeer("http://10.0.0.5:3005", { primaryPath: "/mesh/ping" });

		expect(result.reachable).toBe(false);
		expect(calls).toHaveLength(1);
	});

	it("rejects a malformed URL without touching the network", async () => {
		const calls = stubFetch(() => ok());

		const result = await probePeer("not a url", { primaryPath: "/mesh/ping" });

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
				}) as unknown as Response,
		);

		const result = await probePeer("http://10.0.0.5:3005", { primaryPath: "/mesh/ping" });

		// The probe's job is reachability; an unparseable identity is not a failure.
		expect(result.reachable).toBe(true);
		expect(result.identity).toEqual({});
	});
});
