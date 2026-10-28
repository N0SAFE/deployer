import { describe, expect, it } from "vitest";
import {
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
    // The engine is converged at boot by SwarmBootstrapService, so a
    // non-active engine means convergence FAILED. There is deliberately no
    // plain-container fallback: a second convergence path per supervisor
    // would be a bridge, and the supervisor surfaces the failure instead.
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: false, scope: "node-local" });
    expect(res.runtime).toBe("unavailable");
    expect(res.reason).toContain("SwarmBootstrapService");
  });

  it("unavailable applies to mesh-wide scope too", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: false, scope: "mesh-wide" });
    expect(res.runtime).toBe("unavailable");
  });

  it("managed always wins, even on an active swarm (deployment owns the process)", () => {
    const res = resolveSupervisorRuntime({ managed: true, swarmActive: true, scope: "mesh-wide" });
    expect(res.runtime).toBe("managed");
  });

  it("unknown scope defaults to mesh-wide (safest: replicated, not per-node)", () => {
    const res = resolveSupervisorRuntime({ managed: false, swarmActive: true, scope: null });
    expect(res.runtime).toBe("swarm-replicated");
  });
});

describe("swarmRuntimeForScope", () => {
  it("maps node-local→global and mesh-wide→replicated", () => {
    expect(swarmRuntimeForScope("node-local")).toBe("swarm-global");
    expect(swarmRuntimeForScope("mesh-wide")).toBe("swarm-replicated");
  });
});

// NOTE: the platform's OWN topology table (which supervisors exist, and their
// scope) is app policy, not package mechanism — it is tested beside the table
// in `apps/api/src/core/modules/supervisors/swarm-only-supervision.acceptance.spec.ts`.

describe("platformOverlayNetworkName", () => {
  it("appends -overlay to a plain platform network name", () => {
    expect(platformOverlayNetworkName("deployer-platform")).toBe("deployer-platform-overlay");
  });

  it("is idempotent when already suffixed", () => {
    expect(platformOverlayNetworkName("deployer-platform-overlay")).toBe("deployer-platform-overlay");
  });
});
