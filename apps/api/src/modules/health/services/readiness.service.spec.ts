import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceUnavailableException } from "@nestjs/common";

import { ReadinessService } from "./readiness.service";
import type { ReadinessIndicators } from "../indicators/readiness.indicators";

/**
 * `ReadinessService` converts the Terminus verdict into a plain
 * `{ statusCode, body }` because the readiness route is an Express handler
 * bound before Nest boots (so it can answer during startup).
 *
 * The contract asserted here is what compose consumes: 200 when green, 503 when
 * anything is down — and NEVER a throw, because "a dependency is down" is a
 * legitimate answer to a readiness question, not an error in the probe.
 */

function makeIndicatorsThatResolve(value: unknown) {
  const indicator = (): Promise<unknown> => Promise.resolve(value);
  return {
    database: vi.fn(indicator),
    swarm: vi.fn(indicator),
    services: vi.fn(indicator),
    mesh: vi.fn(indicator),
  } as unknown as ReadinessIndicators;
}

/** A HealthCheckService whose `check` behaves as given. */
function makeHealth(checkImpl: () => Promise<unknown>) {
  return { check: vi.fn(checkImpl) } as unknown as ConstructorParameters<typeof ReadinessService>[0];
}

describe("ReadinessService", () => {
  let indicators: ReadinessIndicators;

  beforeEach(() => {
    indicators = makeIndicatorsThatResolve({ ok: { status: "up" } });
  });

  it("maps a green Terminus verdict to 200 + status ok", async () => {
    const service = new ReadinessService(
      makeHealth(async () => ({ status: "ok", info: { database: { status: "up" } }, error: {}, details: {} })),
      indicators,
    );

    const result = await service.probe();

    expect(result.statusCode).toBe(200);
    expect(result.body.status).toBe("ok");
    expect(result.body.info).toEqual({ database: { status: "up" } });
  });

  it("passes EVERY indicator to Terminus, so a new dependency cannot be forgotten", async () => {
    // The stub invokes each thunk the service hands to Terminus: the real
    // HealthCheckService always executes them, so a stub that ignores them
    // would assert nothing about the service's wiring.
    const health = {
      check: vi.fn(async (indicators: Array<() => Promise<unknown>>) => {
        for (const run of indicators) await run();
        return { status: "ok", info: {}, error: {}, details: {} };
      }),
    } as unknown as ConstructorParameters<typeof ReadinessService>[0];

    const service = new ReadinessService(health, indicators);
    await service.probe();

    // The four dependencies the plan names: database, swarm, services, mesh.
    expect(indicators.database).toHaveBeenCalledTimes(1);
    expect(indicators.swarm).toHaveBeenCalledTimes(1);
    expect(indicators.services).toHaveBeenCalledTimes(1);
    expect(indicators.mesh).toHaveBeenCalledTimes(1);
  });

  it("maps a Terminus 'down' verdict (ServiceUnavailableException) to 503 without throwing", async () => {
    // Terminus signals "down" by THROWING, carrying the health payload as the
    // exception response. The probe must translate that, not propagate it — a
    // rejected probe would make compose mark the container unhealthy for the
    // wrong reason and bury the per-component detail.
    const service = new ReadinessService(
      makeHealth(async () => {
        throw new ServiceUnavailableException({
          status: "error",
          info: { swarm: { status: "up" } },
          error: { database: { status: "down", reason: "connection refused" } },
          details: {},
        });
      }),
      indicators,
    );

    const result = await service.probe();

    expect(result.statusCode).toBe(503);
    expect(result.body.status).toBe("error");
    // The failing component names itself — this is what the setup app turns
    // into a single actionable toast.
    expect(result.body.error).toEqual({ database: { status: "down", reason: "connection refused" } });
  });

  it("reports 503 with a probe-level reason when an indicator itself throws", async () => {
    // A bug in an indicator (not a down dependency) must still answer 503 with
    // SOMETHING diagnosable rather than an unhandled rejection.
    const service = new ReadinessService(
      makeHealth(async () => {
        throw new Error("indicator blew up");
      }),
      indicators,
    );

    const result = await service.probe();

    expect(result.statusCode).toBe(503);
    expect(result.body.error).toEqual({ probe: { reason: "indicator blew up" } });
  });

  it("always stamps a checkedAt timestamp so staleness is observable", async () => {
    const service = new ReadinessService(
      makeHealth(async () => ({ status: "ok", info: {}, error: {}, details: {} })),
      indicators,
    );

    const result = await service.probe();

    expect(Number.isNaN(Date.parse(result.body.checkedAt))).toBe(false);
  });
});
