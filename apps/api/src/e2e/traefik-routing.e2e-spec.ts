import {
  GenericContainer,
  Network,
  Wait,
  type StartedNetwork,
  type StartedTestContainer,
} from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("Traefik routing e2e (Testcontainers)", () => {
  let network: StartedNetwork | undefined;
  let whoamiContainer: StartedTestContainer | undefined;
  let traefikContainer: StartedTestContainer | undefined;

  const routedHost = "app.localtest.me";

  beforeAll(async () => {
    network = await new Network().start();

    whoamiContainer = await new GenericContainer("traefik/whoami:v1.11")
      .withName(`e2e-whoami-${Date.now()}`)
      .withNetwork(network)
      .withNetworkAliases("whoami")
      .withLabels({
        "traefik.enable": "true",
        "traefik.http.routers.whoami.rule": `Host(\`${routedHost}\`)`,
        "traefik.http.routers.whoami.entrypoints": "web",
        "traefik.http.services.whoami.loadbalancer.server.port": "80",
      })
      .start();

    traefikContainer = await new GenericContainer("traefik:v3.6.10")
      .withName(`e2e-traefik-${Date.now()}`)
      .withNetwork(network)
      .withExposedPorts(80)
      .withEnvironment({
        DOCKER_HOST: "unix:///var/run/docker.sock",
      })
      .withBindMounts([{ source: "/var/run/docker.sock", target: "/var/run/docker.sock" }])
      .withCommand([
        "--providers.docker=true",
        "--providers.docker.endpoint=unix:///var/run/docker.sock",
        "--providers.docker.exposedbydefault=false",
        `--providers.docker.network=${network.getName()}`,
        "--entrypoints.web.address=:80",
        "--log.level=INFO",
      ])
      .withWaitStrategy(Wait.forLogMessage(/Starting provider \*docker.Provider/))
      .start();
  }, 120000);

  afterAll(async () => {
    if (traefikContainer) {
      await traefikContainer.stop().catch(() => undefined);
    }
    if (whoamiContainer) {
      await whoamiContainer.stop().catch(() => undefined);
    }
    if (network) {
      await network.stop().catch(() => undefined);
    }
  });

  it("routes host-based traffic to the labeled upstream container", async () => {
    expect(traefikContainer).toBeDefined();
    const localTraefikContainer = traefikContainer;

    if (!localTraefikContainer) {
      throw new Error("Traefik container was not initialized");
    }

    const traefikPort = localTraefikContainer.getMappedPort(80);
    const traefikHost = localTraefikContainer.getHost();

    const startedAt = Date.now();
    const timeoutMs = 30_000;
    let response: Response | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      response = await fetch(`http://${traefikHost}:${String(traefikPort)}/`, {
        headers: {
          Host: routedHost,
        },
      }).catch(() => null);

      if (response?.ok) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);

    if (!response) {
      throw new Error("Expected Traefik response but received null");
    }

    const body = await response.text();
    expect(body).toContain("Hostname");
  });

  it("returns 404 for an unknown host", async () => {
    expect(traefikContainer).toBeDefined();
    const localTraefikContainer = traefikContainer;

    if (!localTraefikContainer) {
      throw new Error("Traefik container was not initialized");
    }

    const traefikPort = localTraefikContainer.getMappedPort(80);
    const traefikHost = localTraefikContainer.getHost();

    const startedAt = Date.now();
    const timeoutMs = 15_000;
    let response: Response | null = null;

    while (Date.now() - startedAt < timeoutMs) {
      response = await fetch(`http://${traefikHost}:${String(traefikPort)}/`, {
        headers: {
          Host: "unknown.localtest.me",
        },
      }).catch(() => null);

      if (response) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    expect(response).not.toBeNull();

    expect(response?.status).toBe(404);
  });
});
