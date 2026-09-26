import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IngressHandoverService } from "./ingress-handover.service";
import { makeEnvService } from "@/test-support/env";

/**
 * The handover writes the two files that decide who owns each hostname. Both
 * invariants it must satisfy are about CONTINUITY, so the assertions are about
 * the file's CONTENT (which router, which backend) rather than about the call:
 *
 *   1. `api.<host>` is retargeted, never deleted — the router must exist in the
 *      file on every write, because a missing router is a Traefik 404.
 *   2. `setup.<host>` is rewritten, never deleted — same reason, for the
 *      operator who bookmarked the wizard.
 *
 * The real filesystem is used (a temp dir), not a mocked `fs`: the failure this
 * guards against is a MALFORMED FILE, and a mock would happily accept one.
 */
describe("IngressHandoverService", () => {
  let dir: string;
  let ingress: IngressHandoverService;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "setup-ingress-"));
    ingress = new IngressHandoverService(makeEnvService({ TRAEFIK_CONFIG_BASE_PATH: dir }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Read a written file, or `null` when it was never created. */
  async function read(name: string): Promise<string | null> {
    try {
      return await readFile(path.join(dir, name), "utf8");
    } catch {
      return null;
    }
  }

  describe("hostname grammar", () => {
    it("uses the unprefixed form when DEPLOYER_PREFIX is empty", () => {
      expect(ingress.apiHostname()).toBe("api.deployer.localhost");
      expect(ingress.setupHostname()).toBe("setup.deployer.localhost");
    });

    it("inserts the prefix after the service label", () => {
      const prefixed = new IngressHandoverService(
        makeEnvService({ TRAEFIK_CONFIG_BASE_PATH: dir, DEPLOYER_PREFIX: "acme" }),
      );

      // The prefix goes in the MIDDLE: `setup.acme.deployer.localhost`. Building
      // it any other way (`acme.setup.…`) would resolve to nothing.
      expect(prefixed.apiHostname()).toBe("api.acme.deployer.localhost");
      expect(prefixed.setupHostname()).toBe("setup.acme.deployer.localhost");
    });
  });

  describe("pointApiAt", () => {
    it("creates the api router pointing at the backend", async () => {
      await ingress.pointApiAt("http://api-dev:3005");

      const yaml = await read("dynamic-api.yml");

      expect(yaml).toContain("platform-api:");
      expect(yaml).toContain("http://api-dev:3005");
      expect(yaml).toContain("Host(`api.deployer.localhost`)");
    });

    it("RETARGETS rather than appending, keeping one router per name", async () => {
      await ingress.pointApiAt("http://api-dev:3005");
      await ingress.pointApiAt("http://deployer-api:3005");

      const yaml = await read("dynamic-api.yml");

      // The whole point of the swap: the operator must see ONE router with the
      // NEW backend. Two `platform-api` routers would be a Traefik config error,
      // and the old backend would keep winning on reload order.
      expect(yaml?.match(/platform-api:/g)).toHaveLength(1);
      expect(yaml).toContain("http://deployer-api:3005");
      expect(yaml).not.toContain("http://api-dev:3005");
    });

    it("leaves no temp file behind", async () => {
      await ingress.pointApiAt("http://api-dev:3005");

      // The write is temp-file + rename for atomicity; a leftover `.tmp` would
      // be a file Traefik's watcher might read and fail on.
      expect(await read("dynamic-api.yml.tmp")).toBeNull();
    });
  });

  describe("pointSetupAtDonePage", () => {
    it("points the setup host at the API's done page", async () => {
      await ingress.pointSetupAtDonePage("http://deployer-api:3005");

      const yaml = await read("dynamic-setup.yml");

      expect(yaml).toContain("platform-setup:");
      expect(yaml).toContain("Host(`setup.deployer.localhost`)");
      // The path matters as much as the host: this is the ROUTE the redirect
      // sends the operator to, so it must be the controller's actual path.
      expect(yaml).toContain("http://deployer-api:3005/setup/done");
    });

    it("gives the setup router a priority above the API console router", async () => {
      await ingress.pointSetupAtDonePage("http://deployer-api:3005");

      const yaml = await read("dynamic-setup.yml");

      // >2000, the console router's priority. Equal or lower and a future API
      // rule could shadow the setup hostname.
      expect(yaml).toMatch(/priority:\s*(\d+)/);
      const priority = Number(/priority:\s*(\d+)/.exec(yaml ?? "")?.[1] ?? "0");
      expect(priority).toBeGreaterThan(2000);
    });
  });

  describe("document shape", () => {
    it("declares exactly one http root, which Traefik requires", async () => {
      await ingress.pointApiAt("http://api-dev:3005");
      const api = await read("dynamic-api.yml");
      await ingress.pointSetupAtDonePage("http://api-dev:3005");
      const setup = await read("dynamic-setup.yml");

      // Traefik's file provider rejects a document with two `http:` keys, so a
      // second root would take down the whole file rather than one router.
      expect(api?.match(/^http:/gm)).toHaveLength(1);
      expect(setup?.match(/^http:/gm)).toHaveLength(1);
    });

    it("emits a service for every router, so no rule dangles", async () => {
      await ingress.pointApiAt("http://api-dev:3005");
      const yaml = await read("dynamic-api.yml");

      // A router naming a service that does not exist is a Traefik error that
      // silently drops the route.
      expect(yaml).toContain("platform-api:");
      expect(yaml).toContain("platform-api-svc:");
    });
  });
});
