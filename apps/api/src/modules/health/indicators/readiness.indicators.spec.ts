import { describe, expect, it } from "vitest";
import { HealthIndicatorService } from "@nestjs/terminus";

import { ReadinessIndicators } from "../indicators/readiness.indicators";
import { AppLifecyclePhase } from "@repo/nest-lifecycle";
import type { ReadinessSnapshot, ReadinessStateService } from "../services/readiness-state.service";

/**
 * The indicators are PURE CACHE READS. That is the property under test: a
 * polled endpoint must not perform I/O, so these specs assert the mapping from
 * cached state to Terminus verdict — and that no dependency is touched.
 *
 * The I/O itself (and its event-driven refresh) is covered in
 * `readiness-state.service.spec.ts`.
 *
 * The REAL `HealthIndicatorService` is used (not a stub): its `up`/`degraded`/
 * `down` payload shape is the contract the setup app parses to build toasts,
 * so faking it would test nothing worth knowing.
 */

function makeIndicators(overrides: Partial<ReadinessSnapshot> = {}) {
  const snapshot: ReadinessSnapshot = {
    lifecyclePhase: AppLifecyclePhase.READY,
    databaseReachable: true,
    meshConnected: true,
    supervisors: [],
    checkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  const state = { snapshot: () => snapshot } as unknown as ReadinessStateService;
  return new ReadinessIndicators(new HealthIndicatorService(), state);
}

/** A supervisor snapshot with the fields the indicator reads. */
function supervisor(
  supervisorId: string,
  healthy: boolean,
  extra: { state?: string; detail?: string | null; warnings?: string[] } = {},
) {
  return {
    supervisorId,
    description: supervisorId,
    healthy,
    state: extra.state ?? (healthy ? "converged" : "degraded"),
    detail: extra.detail ?? null,
    checkedAt: "2026-01-01T00:00:00.000Z",
    warnings: extra.warnings ?? [],
    payload: {},
  } as never;
}

/**
 * Read the `reason` off a Terminus result, which only the `down` variant
 * carries. Asserting `toMatchObject({ status: "down" })` first does not narrow
 * the union for the compiler, so the variant is checked explicitly here — and a
 * result that is NOT down fails loudly instead of silently yielding "".
 */
function downReason(result: { status: string; reason?: string }): string {
  if (result.status !== "down") throw new Error(`expected a down result, got "${result.status}"`);
  return result.reason ?? "";
}

describe("ReadinessIndicators — database", () => {
  it("is up when the lifecycle reports the database reachable", () => {
    expect(makeIndicators({ databaseReachable: true }).database()).toMatchObject({
      database: { status: "up" },
    });
  });

  it("is down BEFORE setup, because no verdict has ever been recorded", () => {
    // The API is started by compose before setup provisions anything. That is a
    // normal pre-handover state — the process must NOT report ready, but it
    // must also not fail for the wrong reason.
    const result = makeIndicators({ databaseReachable: null }).database();
    expect(result.database).toMatchObject({ status: "down" });
    expect(downReason(result.database)).toContain("setup has not provisioned");
  });

  it("is down with the mid-run reason when the lifecycle is DEGRADED", () => {
    // Distinguishing "lost mid-run" from "never configured" is the difference
    // between an operator investigating a recovery loop and one running setup.
    const result = makeIndicators({
      databaseReachable: false,
      lifecyclePhase: AppLifecyclePhase.DEGRADED,
    }).database();

    expect(result.database).toMatchObject({ status: "down" });
    expect(downReason(result.database)).toContain("lost mid-run");
  });

  it("is down with the plain reason when unreachable outside DEGRADED", () => {
    const result = makeIndicators({
      databaseReachable: false,
      lifecyclePhase: AppLifecyclePhase.PROBING,
    }).database();

    expect(downReason(result.database)).toContain("not reachable");
  });
});

describe("ReadinessIndicators — swarm", () => {
  it("is up once the platform is past bootstrap", () => {
    expect(makeIndicators({ lifecyclePhase: AppLifecyclePhase.READY }).swarm()).toMatchObject({
      swarm: { status: "up" },
    });
  });

  it.each([
    AppLifecyclePhase.INITIALIZED,
    AppLifecyclePhase.DISCOVERING,
    AppLifecyclePhase.PROBING,
    AppLifecyclePhase.BOOTSTRAPPING,
  ])("is down during %s, so compose cannot start the dashboard early", (phase) => {
    const result = makeIndicators({ lifecyclePhase: phase }).swarm();

    expect(result.swarm).toMatchObject({ status: "down" });
    expect(downReason(result.swarm)).toContain("setup is not complete");
  });

  it("is down on ERROR", () => {
    const result = makeIndicators({ lifecyclePhase: AppLifecyclePhase.ERROR }).swarm();
    expect(downReason(result.swarm)).toContain("bootstrap failed");
  });

  it("is up while JOINING_MESH — the mesh has its own indicator", () => {
    // Reporting not-ready here would double-count the mesh dependency and
    // block the dashboard during a phase the platform can serve through.
    expect(makeIndicators({ lifecyclePhase: AppLifecyclePhase.JOINING_MESH }).swarm()).toMatchObject({
      swarm: { status: "up" },
    });
  });
});

describe("ReadinessIndicators — services", () => {
  it("is up when every supervised service is healthy", () => {
    const result = makeIndicators({
      supervisors: [supervisor("platform-ingress-traefik", true), supervisor("platform-redis", true)],
    }).services();

    expect(result.services).toMatchObject({ status: "up", total: 2 });
  });

  it("names the failing services so the wizard can toast them individually", () => {
    const result = makeIndicators({
      supervisors: [
        supervisor("platform-ingress-traefik", true),
        supervisor("platform-redis", false, { state: "degraded", detail: "no running task" }),
      ],
    }).services();

    expect(result.services).toMatchObject({
      status: "down",
      failing: [{ supervisor: "platform-redis", state: "degraded", detail: "no running task" }],
    });
  });

  it("is down when no supervisor has registered yet", () => {
    // Booting with zero supervisors means convergence has not started; calling
    // that "healthy" would be a green light on an empty platform.
    expect(makeIndicators({ supervisors: [] }).services()).toMatchObject({
      services: { status: "down" },
    });
  });

  it("reports DEGRADED (still 200) when a supervisor only has warnings", () => {
    // Warnings are non-fatal (e.g. "entry port taken — running headless").
    // Failing readiness for them would make the platform permanently unready
    // for a condition the operator may legitimately accept; hiding them would
    // lose the signal. `degraded` is exactly that middle state: Terminus maps
    // it to HTTP 200, so compose does not gate, but the payload carries it.
    const result = makeIndicators({
      supervisors: [supervisor("platform-ingress-traefik", true, { warnings: ["entry port 80 in use"] })],
    }).services();

    expect(result.services).toMatchObject({
      status: "degraded",
      warnings: [{ supervisor: "platform-ingress-traefik", warning: "entry port 80 in use" }],
    });
  });
});

describe("ReadinessIndicators — mesh", () => {
  it("is down before any mesh verdict exists", () => {
    const result = makeIndicators({ meshConnected: null }).mesh();
    expect(result.mesh).toMatchObject({ status: "down" });
    expect(downReason(result.mesh)).toContain("not been established");
  });

  it("is down when the overlay is not connected", () => {
    const result = makeIndicators({ meshConnected: false }).mesh();
    expect(downReason(result.mesh)).toContain("not connected");
  });

  it("is up when connected — including the single-node case", () => {
    // A single-node cluster is legitimately ready with no peers, and the
    // orchestrator records `meshConnected` for it, so there is no separate
    // node-count branch to get wrong.
    expect(makeIndicators({ meshConnected: true }).mesh()).toMatchObject({
      mesh: { status: "up" },
    });
  });
});

/**
 * The API boots BEFORE setup provisions the database — the API existing early is
 * what lets setup hand over to it. So a DB-touching supervisor can lose that race
 * by seconds, and counting it as a readiness failure deadlocked onboarding:
 * setup waits for `/health/ready` before releasing the entry port, readiness was
 * red because of the race, so the port was never released and traefik was never
 * promoted to a swarm service. The operator saw 3 services instead of 5.
 */
describe("services — the provisioning race is not a fault", () => {
  it("reports UP when a supervisor failed only because the schema was not ready", () => {
    const result = makeIndicators({
      supervisors: [
        supervisor("platform-managed-web", false, {
          detail: 'Failed query: insert into "app_config" ("key", "value", ...) on conflict ("key") do update set "value" = $4',
        }),
      ],
    }).services();

    // UP, not down: nothing is broken, the supervisor simply ran before the
    // schema existed. It is listed as awaiting provisioning instead.
    expect(result.services).toMatchObject({ status: "up" });
    expect(result.services).toMatchObject({
      deferred: [{ supervisor: "platform-managed-web" }],
    });
  });

  it("also exempts a missing relation, which is the same race", () => {
    const result = makeIndicators({
      supervisors: [
        supervisor("platform-managed-web", false, {
          detail: 'relation "app_config" does not exist',
        }),
      ],
    }).services();

    expect(result.services).toMatchObject({ status: "up" });
  });

  it("STILL fails when the database is genuinely unreachable", () => {
    // A connection refusal must not be swallowed by the race exemption —
    // otherwise a real outage would report the platform as ready.
    const result = makeIndicators({
      supervisors: [
        supervisor("platform-redis", false, {
          detail: "connect ECONNREFUSED 10.0.1.8:6379",
        }),
      ],
    }).services();

    expect(result.services).toMatchObject({ status: "down" });
    expect(downReason(result.services)).toContain("not healthy");
  });

  it("STILL fails for an unrelated degradation with no DB error", () => {
    const result = makeIndicators({
      supervisors: [
        supervisor("platform-managed-web", false, {
          detail: "service missing while flag enabled",
        }),
      ],
    }).services();

    expect(result.services).toMatchObject({ status: "down" });
  });
});
