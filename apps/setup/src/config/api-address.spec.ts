import { describe, expect, it } from "vitest";

import { apiServiceName, resolveApiBaseUrl } from "./api-address";

/**
 * The rule that broke twice, so it is pinned here.
 *
 * Both failures looked like unrelated faults on the last wizard screen while
 * having ONE cause — the API address:
 *
 *   Error  The platform API is not reachable yet (api-dev:3005/api/auth)
 *   Error  The platform API is not reachable yet (/setup/trigger)
 */
describe("resolveApiBaseUrl", () => {
  it("uses the configured address verbatim in dev (compose owns the API)", () => {
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://api-dev:3005",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://api-dev:3005");
  });

  it("swaps the host for the swarm service name in prod, keeping the port", () => {
    // `api-dev` does not exist in the prod flow — setup CREATES the API as a
    // swarm service, and that service name is what resolves on the overlay.
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "prod",
        SETUP_API_URL: "http://api-dev:3005",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://deployer-api:3005");
  });

  it("derives the prefixed service name so the address matches the service created", () => {
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "prod",
        SETUP_API_URL: "http://api-dev:3005",
        DEPLOYER_PREFIX: "acme",
      }),
    ).toBe("http://deployer-api-acme:3005");
  });

  it("strips trailing slashes so a forward cannot produce a `//` path", () => {
    expect(
      resolveApiBaseUrl({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://api-dev:3005///",
        DEPLOYER_PREFIX: "",
      }),
    ).toBe("http://api-dev:3005");
  });

  it("returns null when nothing is configured, rather than inventing a host", () => {
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: undefined, DEPLOYER_PREFIX: "" })).toBe(null);
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "", DEPLOYER_PREFIX: "" })).toBe(null);
  });

  it("returns null for a malformed URL instead of silently choosing another host", () => {
    expect(resolveApiBaseUrl({ SETUP_MODE: "prod", SETUP_API_URL: "not a url", DEPLOYER_PREFIX: "" })).toBe(null);
  });

  it("names the service the way `deployer-api` is created", () => {
    expect(apiServiceName("")).toBe("deployer-api");
    expect(apiServiceName("acme")).toBe("deployer-api-acme");
  });
});
