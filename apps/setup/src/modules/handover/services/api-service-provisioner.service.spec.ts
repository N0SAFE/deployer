import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";

import { ApiServiceProvisioner } from "./api-service-provisioner.service";
import { makeEnvService } from "@/test-support/env";
import type { DockerService } from "@repo/nest-docker/services/docker.service";

/**
 * The provisioner is where `SETUP_MODE` actually forks, so the assertions are
 * about the two paths staying distinct:
 *
 *   dev   — nothing is created; the backend is the compose service's address.
 *   prod  — a swarm service is created and reused on retry.
 *
 * Two failure modes are silent in production and therefore worth asserting
 * explicitly:
 *   1. `dev` with no `SETUP_API_URL` inventing a hostname — the ingress would be
 *      pointed at a name that does not resolve, and the operator would see a 502
 *      with no configuration error anywhere.
 *   2. `prod` recreating an existing service — a harmless-looking retry that
 *      RESTARTS a healthy API, turning it into an outage.
 */
function makeProvisioner(
  envOverrides: Record<string, string>,
  docker: Partial<DockerService> = {},
  managedWeb: boolean | null = null,
): { provisioner: ApiServiceProvisioner; docker: Partial<DockerService> } {
  const service = {
    createSwarmService: vi.fn().mockResolvedValue({}),
    inspectSwarmService: vi.fn(),
    // The provisioner creates the platform OVERLAY before attaching the service
    // to it, because a service name only resolves on a swarm-scoped network.
    ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
    ...docker,
  };
  // The wizard's dashboard choice, which the provisioner forwards as the API's
  // `MANAGED_WEB_APP_ENABLED` seed. `null` models "the operator was never asked".
  const gate = { managedWebEnabled: vi.fn(() => managedWeb) };
  const provisioner = new ApiServiceProvisioner(
    makeEnvService(envOverrides),
    service as unknown as DockerService,
    gate as unknown as ConstructorParameters<typeof ApiServiceProvisioner>[2],
  );
  return { provisioner, docker: service };
}

/** `inspectSwarmService` rejecting is how "the service does not exist" surfaces. */
function notFound(): Mock {
  return vi.fn().mockRejectedValue(new Error("Swarm service not found"));
}

describe("ApiServiceProvisioner", () => {
  describe("dev — compose owns the API", () => {
    it("returns the configured address and creates nothing", async () => {
      const { provisioner, docker } = makeProvisioner({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://api-dev:3005",
      });

      const backend = await provisioner.ensureApi();

      expect(backend).toMatchObject({ kind: "container", url: "http://api-dev:3005" });
      // Creating a service in dev would schedule a SECOND API beside the compose
      // one, and both would try to own the same volumes.
      expect(docker.createSwarmService).not.toHaveBeenCalled();
    });

    it("strips a trailing slash so backend URLs do not become `//health/ready`", async () => {
      const { provisioner } = makeProvisioner({
        SETUP_MODE: "dev",
        SETUP_API_URL: "http://api-dev:3005/",
      });

      const backend = await provisioner.ensureApi();

      expect(backend.url).toBe("http://api-dev:3005");
    });

    it("REFUSES to guess an address when SETUP_API_URL is missing", async () => {
      const { provisioner } = makeProvisioner({ SETUP_MODE: "dev" });

      // A guessed hostname would resolve to nothing and surface as an opaque 502
      // on `api.<host>`, with the real cause (missing config) invisible.
      await expect(provisioner.ensureApi()).rejects.toThrow(/SETUP_API_URL/);
    });
  });

  describe("prod — setup schedules the API", () => {
    it("creates a swarm service from DEPLOYER_API_IMAGE", async () => {
      const { provisioner, docker } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          DEPLOYER_API_REPLICAS: "2",
        },
        { inspectSwarmService: notFound() },
      );

      const backend = await provisioner.ensureApi();

      expect(docker.createSwarmService).toHaveBeenCalledOnce();
      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Image: string } };
        Mode: { Replicated: { Replicas: number } };
      };
      // The image is the ONLY input for "which build to run" — that is the plan's
      // single difference between local prod and a real deployment.
      expect(spec.TaskTemplate.ContainerSpec.Image).toBe("deployer-api:local");
      expect(spec.Mode.Replicated.Replicas).toBe(2);
      expect(backend).toMatchObject({ kind: "swarm", serviceName: "deployer-api" });
    });

    it("REUSES an existing service instead of recreating it", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: vi.fn().mockResolvedValue({}) },
      );

      const backend = await provisioner.ensureApi();

      // Recreating would restart a healthy API — a retry of a later step would
      // become an outage.
      expect(docker.createSwarmService).not.toHaveBeenCalled();
      expect(backend).toMatchObject({ kind: "swarm" });
    });

    it("REFUSES to schedule without an image tag", async () => {
      const { provisioner } = makeProvisioner({ SETUP_MODE: "prod" });

      await expect(provisioner.ensureApi()).rejects.toThrow(/DEPLOYER_API_IMAGE/);
    });

    /**
     * REGRESSION GUARD: a swarm task inherits NOTHING from the compose project,
     * so every variable the scheduled app REQUIRES has to be passed explicitly.
     * Omitting one is invisible until the task crash-loops, and the supervisor
     * only reports "service has no running task":
     *
     *   ❌ Environment validation failed:
     *      Invalid input: expected string, received undefined → at AUTH_SECRET
     *
     * `AUTH_SECRET`/`BETTER_AUTH_SECRET` matter most: the API SIGNS the session
     * cookie and the web app's middleware DECRYPTS it, so a mismatch silently
     * signs the operator out on alternate hosts.
     */
    it("passes the scheduled app the env it cannot inherit from compose", async () => {
      const { provisioner, docker } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          AUTH_SECRET: "a-real-shared-secret",
        },
        { inspectSwarmService: notFound() },
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      const env = spec.TaskTemplate.ContainerSpec.Env;

      expect(env).toContain("AUTH_SECRET=a-real-shared-secret");
      // Must MATCH: the web schema rejects them when they differ.
      expect(env).toContain("BETTER_AUTH_SECRET=a-real-shared-secret");
      expect(env.some((e) => e.startsWith("NEXT_PUBLIC_API_URL="))).toBe(true);
      expect(env.some((e) => e.startsWith("NEXT_PUBLIC_APP_URL="))).toBe(true);
      expect(env.some((e) => e.startsWith("APP_URL="))).toBe(true);
    });

    /**
     * Without `AUTH_BASE_DOMAIN` the API has no wildcard, so `trustedOrigins`
     * holds only the explicit app URLs — and the WIZARD's own host is rejected,
     * which is what surfaced as `Invalid origin` on the final click.
     */
    it("forwards the shared auth domain so the wizard's own origin is trusted", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: notFound() },
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      const env = spec.TaskTemplate.ContainerSpec.Env;

      // The LEADING DOT is load-bearing: it produces `*.deployer.localhost`,
      // which matches `setup.deployer.localhost` while rejecting the bare
      // `deployer.localhost`.
      expect(env).toContain("AUTH_BASE_DOMAIN=.deployer.localhost");
      // And the setup origin is named explicitly as a belt-and-braces measure.
      expect(env).toContain("TRUSTED_ORIGINS=http://setup.deployer.localhost");
    });

    it("derives the auth domain from the prefix so a prefixed install is not broken", async () => {
      const { provisioner, docker } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          DEPLOYER_PREFIX: "acme",
          NODE_LOCAL_DB_VOLUME: "proj_api_local_db_data_acme",
        },
        { inspectSwarmService: notFound() },
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      const env = spec.TaskTemplate.ContainerSpec.Env;

      expect(env).toContain("AUTH_BASE_DOMAIN=.acme.deployer.localhost");
      expect(env).toContain("TRUSTED_ORIGINS=http://setup.acme.deployer.localhost");
    });

    /**
     * The wizard's dashboard answer must reach the API, or the operator's choice
     * is silently discarded on a fresh instance (the API would boot on its own
     * env default instead).
     */
    it("forwards the wizard's dashboard choice as the API's seed", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: notFound() },
        true,
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      expect(spec.TaskTemplate.ContainerSpec.Env).toContain("MANAGED_WEB_APP_ENABLED=true");
    });

    it("forwards an explicit API-only choice as false", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: notFound() },
        false,
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      expect(spec.TaskTemplate.ContainerSpec.Env).toContain("MANAGED_WEB_APP_ENABLED=false");
    });

    it("omits the dashboard flag when the operator was never asked", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: notFound() },
        null,
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Env: string[] } };
      };
      // An unasked choice must NOT become `false` — that would silently disable
      // the dashboard instead of leaving the deployment's own default in place.
      expect(spec.TaskTemplate.ContainerSpec.Env.some((e) => e.startsWith("MANAGED_WEB_APP_ENABLED="))).toBe(false);
    });

    it("mounts the shared local-db volume, so the API reads the decision setup wrote", async () => {
      const { provisioner, docker } = makeProvisioner(
        { SETUP_MODE: "prod", DEPLOYER_API_IMAGE: "deployer-api:local" },
        { inspectSwarmService: notFound() },
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Mounts: Array<{ Source: string; Target: string }> } };
      };
      // `node_config` lives here; without the mount the API boots with no idea a
      // cluster exists and would re-run onboarding.
      expect(spec.TaskTemplate.ContainerSpec.Mounts).toContainEqual(
        expect.objectContaining({ Target: "/app/data" }),
      );
    });

    it("prefixes the SERVICE name so tenants stay distinguishable", async () => {
      const { provisioner, docker } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          DEPLOYER_PREFIX: "acme",
          NODE_LOCAL_DB_VOLUME: "proj_api_local_db_data_acme",
        },
        { inspectSwarmService: notFound() },
      );

      const backend = await provisioner.ensureApi();

      // The union is narrowed rather than asserted: only the swarm branch has a
      // service name, and asserting its presence is the point of the test.
      expect(backend.kind).toBe("swarm");
      if (backend.kind !== "swarm") throw new Error("expected a swarm backend");
      expect(backend.serviceName).toBe("deployer-api-acme");

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Mounts: Array<{ Source: string; Target: string }> } };
      };

      // ── THE VOLUME NAME COMES FROM THE ENVIRONMENT ────────────────────────
      // Compose prefixes volumes with its project name, which this process
      // cannot guess. Reconstructing it from DEPLOYER_PREFIX produced a name
      // that matched NOTHING the setup container had written, so the task
      // mounted an empty volume and the API booted with no node state:
      //
      //   Failed query: select "node_id", "server_url" … (db not ready)
      const mounts = spec.TaskTemplate.ContainerSpec.Mounts;
      expect(mounts.map((m) => m.Source)).toContain("proj_api_local_db_data_acme");
    });

    it("mounts the engine socket, without which no supervisor can converge", async () => {
      const { provisioner, docker } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          NODE_LOCAL_DB_VOLUME: "proj_api_local_db_data_prod",
        },
        { inspectSwarmService: notFound() },
      );

      await provisioner.ensureApi();

      const spec = vi.mocked(docker.createSwarmService!).mock.calls[0]?.[0] as {
        TaskTemplate: { ContainerSpec: { Mounts: Array<{ Type: string; Source: string; Target: string }> } };
      };

      // A swarm task inherits NOTHING from the node it runs on, so the socket
      // must be mounted explicitly. Without it every supervisor call fails with
      // `connect ENOENT /var/run/docker.sock` and the platform never converges.
      expect(spec.TaskTemplate.ContainerSpec.Mounts).toContainEqual(
        expect.objectContaining({
          Type: "bind",
          Source: "/var/run/docker.sock",
          Target: "/var/run/docker.sock",
        }),
      );
    });
  });

  describe("backend URL", () => {
    it("uses SETUP_API_PORT so dev and prod do not disagree", async () => {
      const { provisioner } = makeProvisioner(
        {
          SETUP_MODE: "prod",
          DEPLOYER_API_IMAGE: "deployer-api:local",
          SETUP_API_PORT: "3001",
        },
        { inspectSwarmService: notFound() },
      );

      const backend = await provisioner.ensureApi();

      // Prod publishes 3001 and dev 3005; a hardcoded port would be right in one
      // mode and produce an unreachable ingress backend in the other.
      expect(backend.url).toBe("http://deployer-api:3001");
    });
  });
});
