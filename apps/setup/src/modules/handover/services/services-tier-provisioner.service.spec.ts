import { describe, expect, it, vi } from "vitest";

import { makeEnvService } from "@/test-support/env";
import type { DockerService } from "@deployer/nest-docker/services/docker.service";

import { ServicesTierProvisioner } from "./services-tier-provisioner.service";

const IMAGES = {
  DEPLOYER_BFF_IMAGE: "svc-bff:t",
  DEPLOYER_SVC_HEALTH_IMAGE: "svc-health:t",
  DEPLOYER_SVC_IDENTITY_IMAGE: "svc-identity:t",
  DEPLOYER_SVC_PROJECT_IMAGE: "svc-project:t",
  DEPLOYER_SVC_FLEET_IMAGE: "svc-fleet:t",
  DEPLOYER_SVC_RUNTIME_IMAGE: "svc-runtime:t",
};

type CreatedSpec = { Name: string; TaskTemplate: { ContainerSpec: { Env: string[]; Image: string } } };

async function schedule(env: Record<string, string>, managedWeb: boolean | null = null) {
  const created: CreatedSpec[] = [];
  const docker = {
    ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
    createSwarmService: vi.fn((spec: CreatedSpec) => {
      created.push(spec);
      return Promise.resolve({});
    }),
    updateSwarmService: vi.fn().mockResolvedValue(undefined),
    getDockerClient: vi.fn(() => ({ listServices: vi.fn().mockResolvedValue([]) })),
  };
  const gate = { managedWebEnabled: vi.fn(() => managedWeb) };
  const tier = new ServicesTierProvisioner(
    makeEnvService({ SETUP_MODE: "prod", AUTH_SECRET: "s3cret-s3cret-s3cret-s3cret-s3cret", ...IMAGES, ...env }),
    docker as unknown as DockerService,
    gate as unknown as ConstructorParameters<typeof ServicesTierProvisioner>[2],
  );
  const apps = await tier.ensureTier();
  const envOf = (name: string): string[] => {
    const spec = created.find((s) => s.Name === name);
    if (spec === undefined) throw new Error(`service ${name} was not created`);
    return spec.TaskTemplate.ContainerSpec.Env;
  };
  return { apps, created, envOf };
}

describe("ServicesTierProvisioner", () => {
  it("schedules the BFF first, then the five services, from the configured images", async () => {
    const { apps, created } = await schedule({});

    expect(apps.map((a) => a.name)).toEqual(["svc-bff", "svc-health", "svc-identity", "svc-project", "svc-fleet", "svc-runtime"]);
    expect(created[0]?.TaskTemplate.ContainerSpec.Image).toBe("svc-bff:t");
  });

  it("refuses an app with no image tag, naming it", async () => {
    await expect(schedule({ DEPLOYER_SVC_FLEET_IMAGE: "" })).rejects.toThrow(/svc-fleet/);
  });

  describe("environment every app inherits (a swarm task inherits nothing)", () => {
    it("forwards the mesh dataplane choice and the setup origin as a trusted origin", async () => {
      const { envOf } = await schedule({ MESH_AGENT_DATAPLANE: "kernel" });
      const env = envOf("svc-bff");

      expect(env).toContain("MESH_AGENT_DATAPLANE=kernel");
      expect(env).toContain("TRUSTED_ORIGINS=http://setup.deployer.localhost");
      expect(env).toContain("APP_URL=http://deployer-managed-web:3000");
      expect(env).toContain("DEPLOYER_API_TARGET=svc-bff");
    });

    it("defaults the dataplane to `observe` rather than dropping the variable", async () => {
      const { envOf } = await schedule({});
      expect(envOf("svc-bff")).toContain("MESH_AGENT_DATAPLANE=observe");
    });

    it("forwards the tenant prefix and derives every origin from it", async () => {
      const { apps, envOf } = await schedule({ DEPLOYER_PREFIX: "acme" });
      const env = envOf("svc-bff-acme");

      expect(apps[0]?.name).toBe("svc-bff-acme");
      expect(env).toContain("DEPLOYER_PREFIX=acme");
      expect(env).toContain("AUTH_BASE_DOMAIN=.acme.deployer.localhost");
      expect(env).toContain("TRUSTED_ORIGINS=http://setup.acme.deployer.localhost");
      expect(env).toContain("APP_URL=http://deployer-managed-web-acme:3000");
    });

    it("omits DEPLOYER_PREFIX on an unprefixed install", async () => {
      const { envOf } = await schedule({});
      expect(envOf("svc-bff").some((entry) => entry.startsWith("DEPLOYER_PREFIX="))).toBe(false);
    });

    it("forwards the direct-proxy image tag with the other supervised images", async () => {
      const { envOf } = await schedule({ DEPLOYER_DIRECT_PROXY_IMAGE: "proxy:t", MESH_AGENT_IMAGE: "agent:t" });
      expect(envOf("svc-bff")).toEqual(expect.arrayContaining(["DEPLOYER_DIRECT_PROXY_IMAGE=proxy:t", "MESH_AGENT_IMAGE=agent:t"]));
    });
  });

  describe("the dashboard decision", () => {
    const flags = (env: string[]) => env.filter((entry) => entry.startsWith("MANAGED_WEB_APP_"));

    it("the wizard's `managed` answer enables it AND clears EXTERNAL (EXTERNAL short-circuits ENABLED)", async () => {
      const { envOf } = await schedule({ MANAGED_WEB_APP_EXTERNAL: "true" }, true);
      expect(flags(envOf("svc-bff"))).toEqual(["MANAGED_WEB_APP_ENABLED=true", "MANAGED_WEB_APP_EXTERNAL=false"]);
    });

    it("the wizard's `api-only` answer disables it and keeps the deployment's EXTERNAL value", async () => {
      const { envOf } = await schedule({ MANAGED_WEB_APP_EXTERNAL: "true" }, false);
      expect(flags(envOf("svc-bff"))).toEqual(["MANAGED_WEB_APP_ENABLED=false", "MANAGED_WEB_APP_EXTERNAL=true"]);
    });

    it("without an answer the deployment's own env values are forwarded untouched", async () => {
      const { envOf } = await schedule({ MANAGED_WEB_APP_ENABLED: "true", MANAGED_WEB_APP_EXTERNAL: "false" }, null);
      expect(flags(envOf("svc-bff"))).toEqual(["MANAGED_WEB_APP_ENABLED=true", "MANAGED_WEB_APP_EXTERNAL=false"]);
    });

    it("forwards nothing when neither the operator nor the deployment decided", async () => {
      const { envOf } = await schedule({}, null);
      expect(flags(envOf("svc-bff"))).toEqual([]);
    });
  });
});
