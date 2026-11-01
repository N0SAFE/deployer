import { toDockerServiceSpec } from "@deployer/docker";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { NodeDoorClient, NodeDoorStatus } from "@deployer/mesh-client";

import { makeEnvService } from "@/test-support/env";
import type { DockerEngineShape } from "@deployer/docker";

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

/** A door that answers once with `status`, or not at all (null) — the two states the provisioner must handle. */
const doorWith = (status: NodeDoorStatus | null): NodeDoorClient =>
  ({ status: async () => status }) as unknown as NodeDoorClient;

/** The provisioner with its door replaced: a test has no agent socket to dial. */
class TestTier extends ServicesTierProvisioner {
  constructor(
    env: ConstructorParameters<typeof ServicesTierProvisioner>[0],
    docker: DockerEngineShape,
    gate: ConstructorParameters<typeof ServicesTierProvisioner>[2],
    private readonly door_: NodeDoorClient,
  ) {
    super(env, docker, gate);
  }

  protected override door(): NodeDoorClient {
    return this.door_;
  }
}

async function schedule(env: Record<string, string>, managedWeb: boolean | null = null, status: NodeDoorStatus | null = null) {
  const created: CreatedSpec[] = [];
  // The engine's `reconcile` takes the platform's spec; the Docker spec it becomes is what the
  // assertions read, so the mapper runs for real.
  const docker = ({
      networks: { ensureOverlay: () => Effect.void },
      swarmServices: {
        reconcile: (input: Parameters<typeof toDockerServiceSpec>[0]) =>
          Effect.sync(() => {
            created.push(toDockerServiceSpec(input) as unknown as CreatedSpec);
          }),
      },
    });
  const gate = { managedWebEnabled: vi.fn(() => managedWeb) };
  const tier = new TestTier(
    makeEnvService({ SETUP_MODE: "prod", AUTH_SECRET: "s3cret-s3cret-s3cret-s3cret-s3cret", ...IMAGES, ...env }),
    docker as unknown as DockerEngineShape,
    gate as unknown as ConstructorParameters<typeof ServicesTierProvisioner>[2],
    doorWith(status),
  );
  // Nest calls this before the app runs; the address is resolved once, there.
  await tier.onModuleInit();
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
    it("forwards the setup origin as a trusted origin", async () => {
      const { envOf } = await schedule({});
      const env = envOf("svc-bff");

      expect(env).toContain("TRUSTED_ORIGINS=http://setup.deployer.localhost");
      expect(env).toContain("APP_URL=http://deployer-managed-web:3000");
      expect(env).toContain("DEPLOYER_API_TARGET=svc-bff");
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
      const { envOf } = await schedule({ DEPLOYER_DIRECT_PROXY_IMAGE: "proxy:t", NODE_AGENT_IMAGE: "agent:t" });
      expect(envOf("svc-bff")).toEqual(expect.arrayContaining(["DEPLOYER_DIRECT_PROXY_IMAGE=proxy:t", "NODE_AGENT_IMAGE=agent:t"]));
    });
  });

  describe("the node's mesh address (what a replica advertises)", () => {
    const advertised = (env: string[]) => env.find((entry) => entry.startsWith("MESH_ADVERTISE_URL="));

    it("gives every app the agent's host on its own port", async () => {
      const { apps, envOf } = await schedule({}, null, {
        advertiseAddress: "ws://10.0.0.7:3106/mesh/ws",
      } as unknown as NodeDoorStatus);

      for (const app of apps) {
        expect(advertised(envOf(app.name))).toBe(`MESH_ADVERTISE_URL=ws://10.0.0.7:${String(app.port)}/mesh/ws`);
      }
    });

    it("omits the variable when the agent is silent, and still schedules the tier", async () => {
      const { apps, envOf } = await schedule({});

      expect(apps).toHaveLength(6);
      expect(advertised(envOf("svc-bff"))).toBeUndefined();
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
