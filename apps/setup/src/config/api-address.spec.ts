import { describe, expect, it } from "vitest";

import { resolveApiBaseUrl } from "./api-address";

/**
 * The rule that broke twice, so it is pinned here.
 *
 * Both failures looked like unrelated faults on the last wizard screen while
 * having ONE cause — the API address:
 *
 *   Error  The platform API is not reachable yet (bff:3005/api/auth)
 *   Error  The platform API is not reachable yet (/setup/trigger)
 */
describe("resolveApiBaseUrl", () => {
  it("uses the configured address verbatim in dev (compose owns the API)", () => {
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://bff:3005",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://bff:3005");
  });

  it("KEEPS the configured host in prod, because that host is the service it dials", () => {
    // This used to swap the host for `apiServiceName()` — the monolith's name. That
    // is only correct on a node whose public app IS the monolith, and it broke the
    // microservices tier: setup dialed `svc-bff` while `svc-bff` was the
    // service that existed, so the handover could not reach the app it had just
    // scheduled:
    //
    //   Upstream http://svc-bff:3005/health/ready unreachable:
    //   getaddrinfo ENOTFOUND svc-bff
    //
    // `SETUP_API_URL` already names the service the deployment schedules, which is
    // the name the ingress is pointed at — so keeping it makes "where setup dials"
    // and "where the ingress routes" ONE value instead of two guesses.
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "prod",
        SETUP_API_URL: "http://svc-bff:3005",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://svc-bff:3005");
  });

  it("keeps the configured host under a tenant prefix, too", () => {
    // The prefix affects the SERVICE the provisioner creates (`svc-bff-acme`),
    // not what this function is given: the operator's `SETUP_API_URL` is already
    // prefixed. Rewriting it here would be a second naming rule that can drift.
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "prod",
        SETUP_API_URL: "http://svc-bff-acme:3005",
        DEPLOYER_PREFIX: "acme",
      }),
    ).toBe("http://svc-bff-acme:3005");
  });

  it("omits the port entirely when the URL has none, rather than emitting a trailing colon", () => {
    // `URL` reports "" for a default port. Interpolating it would give
    // `http://svc-bff:` — a malformed authority `fetch` rejects outright, so a
    // portless config would fail at the first forward with a parse error instead of
    // reaching the API on its protocol default.
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "prod",
        SETUP_API_URL: "http://svc-bff",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://svc-bff");
  });

  it("returns null for a URL whose host is empty, because `URL` rejects it", () => {
    // There is no "configured but hostless" case to fall back from: `new URL`
    // throws "Invalid URL" for `http://:3005` and `http://` alike. A fallback to
    // the monolith's service name here was therefore UNREACHABLE — it implied a
    // state that cannot occur, and the test that pinned it was asserting dead code.
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "http://:3005", DEPLOYER_PREFIX: "" })).toBe(null);
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "http://", DEPLOYER_PREFIX: "" })).toBe(null);
  });

  it("strips trailing slashes so a forward cannot produce a `//` path", () => {
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://bff:3005///",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://bff:3005");
  });

  it("returns null when nothing is configured, rather than inventing a host", () => {
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: undefined, DEPLOYER_PREFIX: "" })).toBe(null);
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "", DEPLOYER_PREFIX: "" })).toBe(null);
  });

  it("returns null for a malformed URL instead of silently choosing another host", () => {
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "not a url", DEPLOYER_PREFIX: "" })).toBe(null);
  });
});
