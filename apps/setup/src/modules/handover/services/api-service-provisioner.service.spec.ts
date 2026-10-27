import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { ApiServiceProvisioner } from "./api-service-provisioner.service";
import { makeEnvService } from "@/test-support/env";
import type { DockerService } from "@deployer/nest-docker/services/docker.service";

/**
 * The provisioner is where `SETUP_MODE` actually forks, so the assertions are
 * about the two paths staying distinct:
 *
 *   dev   — nothing is created; the backend is the compose BFF's address.
 *   prod  — the microservices tier is scheduled (idempotently) and the BFF is the backend.
 *
 * Two failure modes are silent in production and therefore worth asserting
 * explicitly:
 *   1. `dev` with no `SETUP_API_URL` inventing a hostname — the ingress would be
 *      pointed at a name that does not resolve, and the operator would see a 502
 *      with no configuration error anywhere.
 *   2. `prod` without a BFF image scheduling nothing and handing over to a name that
 *      never exists.
 */

type TierApp = { name: string; image: string; port: number };

function makeProvisioner(
  envOverrides: Record<string, string>,
  docker: Partial<DockerService> = {},
  tierApps: TierApp[] | null = null,
): {
  provisioner: ApiServiceProvisioner;
  docker: Partial<DockerService>;
  tier: { ensureTier: Mock };
} {
  const service = {
    createSwarmService: vi.fn().mockResolvedValue({}),
    // The provisioner creates the platform OVERLAY before scheduling the tier, because a
    // service name only resolves on a swarm-scoped network.
    ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
    ...docker,
  };
  const prefix = envOverrides.DEPLOYER_PREFIX ?? "";
  const bffName = prefix === "" ? "svc-bff" : `svc-bff-${prefix}`;
  const tier = {
    ensureTier: vi.fn().mockResolvedValue(
      tierApps ?? [{ name: bffName, image: envOverrides.DEPLOYER_BFF_IMAGE ?? "svc-bff:local", port: 3005 }],
    ),
  };
  const provisioner = new ApiServiceProvisioner(
    makeEnvService(envOverrides),
    // Partial double: the provisioner uses only a handful of the engine's methods.
    service as unknown as DockerService,
    tier as unknown as ConstructorParameters<typeof ApiServiceProvisioner>[2],
  );
  return { provisioner, docker: service, tier };
}

describe("ApiServiceProvisioner", () => {
  describe("dev — compose owns the BFF", () => {
    it("returns the configured address and schedules nothing", async () => {
      const { provisioner, docker, tier } = makeProvisioner({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://bff:3005",
      });

      const backend = await provisioner.ensureApi();

      expect(backend).toMatchObject({ kind: "container", url: "http://bff:3005" });
      // Scheduling the tier in dev would run a SECOND BFF beside the compose one, and both
      // would try to own the same volumes.
      expect(tier.ensureTier).not.toHaveBeenCalled();
      expect(docker.createSwarmService).not.toHaveBeenCalled();
    });

    it("strips a trailing slash so backend URLs do not become `//health/ready`", async () => {
      const { provisioner } = makeProvisioner({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://bff:3005/",
      });

      const backend = await provisioner.ensureApi();

      expect(backend.url).toBe("http://bff:3005");
    });

    it("REFUSES to guess an address when SETUP_API_URL is missing", async () => {
      const { provisioner } = makeProvisioner({ SETUP_MODE: "dev" });

      // A guessed hostname would resolve to nothing and surface as an opaque 502
      // on `api.<host>`, with the real cause (missing config) invisible.
      await expect(provisioner.ensureApi()).rejects.toThrow(/SETUP_API_URL/);
    });
  });

  describe("prod — setup schedules the tier", () => {
    it("ensures the overlay, schedules the tier and hands over to the BFF", async () => {
      const { provisioner, docker, tier } = makeProvisioner({
        SETUP_MODE: "prod",
        DEPLOYER_BFF_IMAGE: "svc-bff:local",
      });

      const backend = await provisioner.ensureApi();

      expect(docker.ensureOverlayNetwork).toHaveBeenCalledOnce();
      expect(tier.ensureTier).toHaveBeenCalledOnce();
      expect(backend).toMatchObject({ kind: "swarm", serviceName: "svc-bff", url: "http://svc-bff:3005" });
      // The tier provisioner owns service creation; this class creates nothing itself.
      expect(docker.createSwarmService).not.toHaveBeenCalled();
    });

    it("REFUSES to hand over without a BFF image tag, and schedules nothing", async () => {
      const { provisioner, docker, tier } = makeProvisioner({ SETUP_MODE: "prod" });

      await expect(provisioner.ensureApi()).rejects.toThrow(/DEPLOYER_BFF_IMAGE/);
      expect(tier.ensureTier).not.toHaveBeenCalled();
      expect(docker.ensureOverlayNetwork).not.toHaveBeenCalled();
    });

    it("refuses to hand over when the tier was scheduled without a BFF", async () => {
      const { provisioner } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_BFF_IMAGE: "svc-bff:local" },
        {},
        [{ name: "svc-fleet", image: "svc-fleet:local", port: 3104 }],
      );

      await expect(provisioner.ensureApi()).rejects.toThrow(/without a BFF/);
    });

    it("prefixes the BFF name so tenants stay distinguishable, matching the tier provisioner", async () => {
      const { provisioner } = makeProvisioner({
        SETUP_MODE: "prod",
        DEPLOYER_BFF_IMAGE: "svc-bff:local",
        DEPLOYER_PREFIX: "acme",
      });

      const backend = await provisioner.ensureApi();

      expect(backend).toMatchObject({ serviceName: "svc-bff-acme", url: "http://svc-bff-acme:3005" });
    });

    it("schedules the overlay BEFORE the tier, so the services attach to a network that exists", async () => {
      const { provisioner, docker, tier } = makeProvisioner({
        SETUP_MODE: "prod",
        DEPLOYER_BFF_IMAGE: "svc-bff:local",
      });

      await provisioner.ensureApi();

      const overlayOrder = (docker.ensureOverlayNetwork as Mock).mock.invocationCallOrder[0] ?? 0;
      const tierOrder = tier.ensureTier.mock.invocationCallOrder[0] ?? 0;
      expect(overlayOrder).toBeLessThan(tierOrder);
    });

    /**
     * A network whose VXLAN datapath is poisoned cannot be joined, and polling
     * never fixes it:
     *
     *   subnet sandbox join failed for "10.0.1.0/24":
     *   error creating vxlan interface: file exists
     *
     * The VNI is the poisoned part, so after two consecutive failures the overlay
     * is rebuilt on another one and the attach retried. A single failure is the
     * engine's normal first-join hiccup and must NOT cost anyone their services.
     */
    describe("poisoned overlay datapath", () => {
      const datapathError = () =>
        new Error(
          "failed to set up container networking: attaching to network failed: " +
            "subnet sandbox join failed for 10.0.1.0/24: error creating vxlan interface: file exists",
        );

      async function run(connect: ReturnType<typeof vi.fn>) {
        const recreateOverlayNetwork = vi
          .fn()
          .mockResolvedValue({ vxlanId: 4098, avoidedVxlanIds: [4097], removedServices: [] });
        const { provisioner, docker } = makeProvisioner(
          { SETUP_MODE: "prod", DEPLOYER_BFF_IMAGE: "svc-bff:local" },
          {
            recreateOverlayNetwork,
            getDockerClient: vi.fn(() => ({ getNetwork: vi.fn(() => ({ connect })) })),
          } as unknown as Partial<DockerService>,
        );
        const statics = ApiServiceProvisioner as unknown as { ATTACH_POLL_MS: number };
        const previousPoll = statics.ATTACH_POLL_MS;
        statics.ATTACH_POLL_MS = 0;
        // HOSTNAME must look like a container id or the attach is skipped entirely.
        const previousHostname = process.env.HOSTNAME;
        process.env.HOSTNAME = "a".repeat(12);
        try {
          const result = await provisioner.ensureApi().then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
          return { result, docker, recreateOverlayNetwork };
        } finally {
          statics.ATTACH_POLL_MS = previousPoll;
          if (previousHostname === undefined) delete process.env.HOSTNAME;
          else process.env.HOSTNAME = previousHostname;
        }
      }

      it("rebuilds the overlay on a fresh VNI after two consecutive datapath failures", async () => {
        const connect = vi
          .fn()
          .mockRejectedValueOnce(datapathError())
          .mockRejectedValueOnce(datapathError())
          .mockResolvedValueOnce(undefined);
        const { result, recreateOverlayNetwork } = await run(connect);

        expect(result).toHaveProperty("value");
        expect(recreateOverlayNetwork).toHaveBeenCalledTimes(1);
        expect(recreateOverlayNetwork).toHaveBeenCalledWith(
          expect.objectContaining({ attachable: true }),
          expect.objectContaining({ detachContainerIds: ["a".repeat(12)] }),
        );
        expect(connect).toHaveBeenCalledTimes(3);
      });

      it("leaves the overlay alone after a single transient failure", async () => {
        const connect = vi.fn().mockRejectedValueOnce(datapathError()).mockResolvedValueOnce(undefined);
        const { result, recreateOverlayNetwork } = await run(connect);

        expect(result).toHaveProperty("value");
        expect(recreateOverlayNetwork).not.toHaveBeenCalled();
      });

      it("stops after a bounded number of rebuilds and reports the engine's words", async () => {
        const connect = vi.fn().mockRejectedValue(datapathError());
        // Collapse the 60s attach budget so exhaustion is reachable in a unit test.
        const statics = ApiServiceProvisioner as unknown as { ATTACH_TIMEOUT_MS: number };
        const previousTimeout = statics.ATTACH_TIMEOUT_MS;
        statics.ATTACH_TIMEOUT_MS = 50;
        try {
          const { result, recreateOverlayNetwork } = await run(connect);
          expect(result).toHaveProperty("error");
          expect(recreateOverlayNetwork.mock.calls.length).toBeLessThanOrEqual(3);
          expect(String((result as { error: Error }).error.message)).toMatch(/vxlan interface/);
        } finally {
          statics.ATTACH_TIMEOUT_MS = previousTimeout;
        }
      });
    });
  });

  describe("backend URL", () => {
    it("uses SETUP_API_PORT so dev and prod do not disagree", async () => {
      const { provisioner } = makeProvisioner({
        SETUP_MODE: "prod",
        DEPLOYER_BFF_IMAGE: "svc-bff:local",
        SETUP_API_PORT: "3001",
      });

      const backend = await provisioner.ensureApi();

      // A hardcoded port would be right in one mode and produce an unreachable ingress backend in the other.
      expect(backend.url).toBe("http://svc-bff:3001");
    });
  });
});
