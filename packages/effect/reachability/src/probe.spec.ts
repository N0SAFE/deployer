import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { EgressPolicy, SafeHttp } from "@deployer/effect-infra";
import { probeAddress, probePeer } from "./probe";

/**
 * `SafeHttp.fake` is the package's own test double: it applies the real scheme/host
 * policy to each request and never touches a socket. Using it means these specs test
 * the probing SEMANTICS (which urls, in what order, how an answer is read) against
 * the real policy code rather than a mock that agrees with whatever we wrote.
 */
const answering = (status: number, body?: unknown) =>
  SafeHttp.fake(() => ({
    status,
    headers: {},
    body: new TextEncoder().encode(body === undefined ? "" : JSON.stringify(body)),
    url: "",
  })).layer;

const run = <A>(effect: Effect.Effect<A, never, SafeHttp>, layer: Layer.Layer<SafeHttp>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer)));

describe("probeAddress", () => {
  it("answers from the first path that returns 2xx and reports the url that did", async () => {
    const { layer, calls } = SafeHttp.fake(() => ({
      status: 200,
      headers: {},
      body: new Uint8Array(),
      url: "",
    }));

    const result = await run(
      probeAddress("example.com", { policy: EgressPolicy.userSupplied, paths: ["/health", "/ping"] }),
      layer,
    );

    expect(result.valid).toBe(true);
    expect(result.probeUrl).toBe("https://example.com/health");
    expect(calls).toHaveLength(1);
  });

  it("tries the next path when one answers non-2xx", async () => {
    let seen = 0;
    const { layer } = SafeHttp.fake(() => {
      seen += 1;
      return { status: seen === 1 ? 503 : 200, headers: {}, body: new Uint8Array(), url: "" };
    });

    const result = await run(
      probeAddress("example.com", { policy: EgressPolicy.userSupplied, paths: ["/health", "/ping"] }),
      layer,
    );

    expect(result.valid).toBe(true);
    expect(result.probeUrl).toBe("https://example.com/ping");
  });

  it("falls back to http when the certificate is not there yet", async () => {
    const { layer } = SafeHttp.fake((req) => ({
      status: req.url.startsWith("http://") ? 200 : 0,
      headers: {},
      body: new Uint8Array(),
      url: req.url,
    }));

    const result = await run(
      probeAddress("example.com", {
        policy: EgressPolicy.userSupplied,
        paths: ["/health"],
        tryBothSchemes: true,
      }),
      layer,
    );

    expect(result.valid).toBe(true);
    expect(result.probeUrl).toBe("http://example.com/health");
  });

  it("reports a miss instead of failing when nothing answers", async () => {
    const { layer } = SafeHttp.fake(() => ({ status: 404, headers: {}, body: new Uint8Array(), url: "" }));

    const result = await run(
      probeAddress("example.com", { policy: EgressPolicy.userSupplied, paths: ["/health"] }),
      layer,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("did not respond");
  });

  it("does not probe an empty address", async () => {
    const { layer, calls } = SafeHttp.fake(() => ({
      status: 200,
      headers: {},
      body: new Uint8Array(),
      url: "",
    }));

    const result = await run(
      probeAddress("   ", { policy: EgressPolicy.userSupplied, paths: ["/health"] }),
      layer,
    );

    expect(result).toEqual({ valid: false, reason: "Address is empty" });
    expect(calls).toHaveLength(0);
  });

  it("reports a refused target as a miss, with the caller's message", async () => {
    // The real policy refuses loopback for a user-supplied target; `fake` still runs
    // the policy checks, so this is a real refusal rather than a stubbed failure.
    const { layer } = SafeHttp.fake(() => ({ status: 200, headers: {}, body: new Uint8Array(), url: "" }));

    const result = await run(
      probeAddress("http://127.0.0.1:3005", {
        policy: EgressPolicy.userSupplied,
        paths: ["/health"],
        failureReason: () => "Custom reason",
      }),
      layer,
    );

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Custom reason");
  });
});

describe("probePeer", () => {
  it("returns the identity the peer reported", async () => {
    const layer = answering(200, { advertisedHost: "10.0.0.5", version: "1.2.3" });

    const result = await run(
      probePeer("https://10.0.0.5:3005", {
        policy: EgressPolicy.operatorTarget,
        primaryPath: "/mesh/ping",
      }),
      layer,
    );

    expect(result.reachable).toBe(true);
    expect(result.identity).toBeInstanceOf(Object);
    expect(result.identity?.advertisedHost).toBe("10.0.0.5");
    expect(result.identity?.version).toBe("1.2.3");
  });

  it("uses the liveness fallback when the primary path is not ready", async () => {
    const { layer } = SafeHttp.fake((req) => ({
      status: req.url.endsWith("/health") ? 200 : 503,
      headers: {},
      body: new Uint8Array(),
      url: req.url,
    }));

    const result = await run(
      probePeer("https://10.0.0.5:3005", {
        policy: EgressPolicy.operatorTarget,
        primaryPath: "/mesh/ping",
        fallbackPath: "/health",
      }),
      layer,
    );

    expect(result.reachable).toBe(true);
    expect(result.probeUrl).toBe("https://10.0.0.5:3005/health");
  });

  it("reports both statuses when neither path answers", async () => {
    const layer = answering(503);

    const result = await run(
      probePeer("https://10.0.0.5:3005", {
        policy: EgressPolicy.operatorTarget,
        primaryPath: "/mesh/ping",
        fallbackPath: "/health",
      }),
      layer,
    );

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("/mesh/ping");
    expect(result.error).toContain("/health");
  });

  it("keeps a malformed body from failing the probe — the peer still answered", async () => {
    const { layer } = SafeHttp.fake(() => ({
      status: 200,
      headers: {},
      body: new TextEncoder().encode("not json"),
      url: "",
    }));

    const result = await run(
      probePeer("https://10.0.0.5:3005", { policy: EgressPolicy.operatorTarget, primaryPath: "/mesh/ping" }),
      layer,
    );

    expect(result.reachable).toBe(true);
    expect(result.identity).toBeUndefined();
  });

  it("rejects a url it cannot parse instead of throwing", async () => {
    const { layer, calls } = SafeHttp.fake(() => ({
      status: 200,
      headers: {},
      body: new Uint8Array(),
      url: "",
    }));

    const result = await run(
      probePeer("not a url", { policy: EgressPolicy.operatorTarget, primaryPath: "/mesh/ping" }),
      layer,
    );

    expect(result.reachable).toBe(false);
    expect(result.error).toBe("Invalid URL format");
    expect(calls).toHaveLength(0);
  });
});
