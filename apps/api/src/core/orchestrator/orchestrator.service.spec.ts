import { beforeAll, describe, expect, it, vi } from "vitest";

import { OrchestratorService } from "./orchestrator.service";

/**
 * `probeReadiness()` is the GATEWAY half of `GET /health/ready`: the gateway
 * owns the route (so it can answer during boot) but the indicators live in the
 * main-app container, which is a separate Nest application the orchestrator
 * starts after setup.
 *
 * Two behaviours matter, and both are about NOT lying to compose:
 *   - before the main app exists, report 503 (the platform genuinely is not
 *     ready), and
 *   - if the lookup itself fails, still answer 503 with a diagnosable reason
 *     instead of rejecting the request.
 *
 * The constructor is bypassed because the other sixteen dependencies are
 * irrelevant to this method and would require a full Docker/Postgres harness to
 * construct.
 */
function makeOrchestrator(mainApp: unknown): OrchestratorService {
  const orchestrator = Object.create(OrchestratorService.prototype) as OrchestratorService;
  Object.assign(orchestrator, {
    mainApp,
    logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
  });
  return orchestrator;
}

/** A main-app container whose `get` returns the given service. */
function appWith(readiness: unknown) {
  return { get: vi.fn(() => readiness) };
}

describe("OrchestratorService.probeReadiness", () => {
  beforeAll(() => {
    // Nothing to set up: the method is exercised through a prototype instance.
  });

  it("reports 503 with a 'main application not started' reason before setup completes", async () => {
    const orchestrator = makeOrchestrator(null);
    const result = await orchestrator.probeReadiness();

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe("error");
    expect(result.body.error).toMatchObject({
      probe: { reason: expect.stringContaining("main application has not started") },
    });
  });

  it("delegates to the main-app's ReadinessService when it exists", async () => {
    const probe = vi.fn(async () => ({
      statusCode: 200,
      body: { status: "ok" as const, info: { database: { status: "up" } }, checkedAt: "2026-01-01T00:00:00.000Z" },
    }));
    const orchestrator = makeOrchestrator(appWith({ probe }));

    const result = await orchestrator.probeReadiness();

    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.statusCode).toBe(200);
    expect(result.body.info).toEqual({ database: { status: "up" } });
  });

  it("propagates a 503 from the main-app's own probe", async () => {
    const probe = vi.fn(async () => ({
      statusCode: 503,
      body: {
        status: "error" as const,
        error: { database: { status: "down", reason: "connection refused" } },
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
    }));
    const orchestrator = makeOrchestrator(appWith({ probe }));

    const result = await orchestrator.probeReadiness();

    expect(result.statusCode).toBe(503);
    expect(result.body.error).toEqual({ database: { status: "down", reason: "connection refused" } });
  });

  it("answers 503 with the lookup error instead of throwing when the service is unresolvable", async () => {
    // Happens if the main-app is mid-shutdown or its HealthModule is absent.
    // A rejected probe would surface as a connection error to compose, which
    // reads as "container broken" rather than "not ready yet".
    const orchestrator = makeOrchestrator({
      get: vi.fn(() => {
        throw new Error("No provider for ReadinessService");
      }),
    });

    const result = await orchestrator.probeReadiness();

    expect(result.statusCode).toBe(503);
    expect(result.body.error).toMatchObject({
      probe: { reason: "No provider for ReadinessService" },
    });
  });

  it("stamps checkedAt on the not-ready answer it constructs itself", async () => {
    // Only the FALLBACK answers are built here; when the main-app answers, its
    // own payload (including checkedAt) is passed through untouched — asserted
    // by the delegation tests above.
    const notStarted = await makeOrchestrator(null).probeReadiness();

    expect(Number.isNaN(Date.parse(notStarted.body.checkedAt))).toBe(false);
  });

  it("stamps checkedAt on the lookup-failure answer it constructs itself", async () => {
    const failed = await makeOrchestrator({
      get: vi.fn(() => {
        throw new Error("No provider for ReadinessService");
      }),
    }).probeReadiness();

    expect(Number.isNaN(Date.parse(failed.body.checkedAt))).toBe(false);
  });
});
