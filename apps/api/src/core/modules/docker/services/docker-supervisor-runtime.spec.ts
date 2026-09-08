import { describe, expect, it } from "vitest";
import {
  PLATFORM_SUPERVISOR_TOPOLOGY,
  getSupervisorTopology,
  platformOverlayNetworkName,
  resolveSupervisorRuntime,
  swarmRuntimeForScope,
} from "./docker-supervisor-runtime";

describe("resolveSupervisorRuntime — NO legacy container fallback", () => {
  it("managed=true always wins with link-only runtime", () => {
    const res = resolveSupervisorRuntime({ managed: true, swarmActive: true, scope: "node-local" });
    expect(res.runtime).toBe("managed");
  });

  it("SUPERVISOR_RUNTIME=managed forces link-only even without the flag", () => {
    const res = resolveSupervisorRuntime({ managed: false, rawRuntime: "managed", swarmActive: true });
    expect(res.runtime).toBe("managed");
  });

  it("node-local scope + active swarm → swarm-global", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: "node-local" });
    expect(res.runtime).toBe("swarm-global");
  });

  it("mesh-wide scope + active swarm → swarm-replicated", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: "mesh-wide" });
    expect(res.runtime).toBe("swarm-replicated");
  });

  it("swarm not active + not managed → unavailable (NO container fallback)", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: false, scope: "node-local" });
    expect(res.runtime).toBe("unavailable");
  });

  it("unknown scope defaults to mesh-wide (safest: replicated, not per-node)", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: null });
    expect(res.runtime).toBe("swarm-replicated");
  });
});

describe("supervisor topology classification", () => {
  it("covers every docker-backed platform supervisor", () => {
    const ids = PLATFORM_SUPERVISOR_TOPOLOGY.map((t) => t.supervisorId);
    expect(ids).toContain("platform-ingress-traefik");
    expect(ids).toContain("platform-redis");
    expect(ids).toContain("global-db-postgres");
    expect(ids).toContain("database-service");
    expect(ids).toContain("platform-direct-port-proxy");
    expect(ids).toContain("platform-managed-web");
    expect(ids).toContain("wireguard");
  });

  it("ingress, direct-port-proxy and wireguard are node-local (swarm-global)", () => {
    expect(getSupervisorTopology("platform-ingress-traefik")?.scope).toBe("node-local");
    expect(getSupervisorTopology("platform-direct-port-proxy")?.scope).toBe("node-local");
    expect(getSupervisorTopology("wireguard")?.scope).toBe("node-local");
  });

  it("redis, global-db, database-service and managed-web are mesh-wide (replicated)", () => {
    expect(getSupervisorTopology("platform-redis")?.scope).toBe("mesh-wide");
    expect(getSupervisorTopology("global-db-postgres")?.scope).toBe("mesh-wide");
    expect(getSupervisorTopology("database-service")?.scope).toBe("mesh-wide");
    expect(getSupervisorTopology("platform-managed-web")?.scope).toBe("mesh-wide");
  });

  it("swarmRuntimeForScope maps node-local→global and mesh-wide→replicated", () => {
    expect(swarmRuntimeForScope("node-local")).toBe("swarm-global");
    expect(swarmRuntimeForScope("mesh-wide")).toBe("swarm-replicated");
  });

  it("returns null for unknown supervisors (e.g. local-db sqlite is not docker)", () => {
    expect(getSupervisorTopology("local-db-sqlite")).toBeNull();
  });
});

describe("platformOverlayNetworkName", () => {
  it("appends -overlay to a plain platform network name", () => {
    expect(platformOverlayNetworkName("deployer-platform")).toBe("deployer-platform-overlay");
  });

  it("is idempotent when already suffixed", () => {
    expect(platformOverlayNetworkName("deployer-platform-overlay")).toBe("deployer-platform-overlay");
  });
});
