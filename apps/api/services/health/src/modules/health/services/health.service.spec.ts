import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { HealthRegistryRepository, UptimeSource } from "../services/health.service";
import { HealthService, SERVICE_NAME } from "./health.service";
import { healthRegistryFake, healthSnapshot } from "../testing/health.fixtures";

const service = HealthService.live;

function report(
  runOnce: () => Promise<ReturnType<typeof healthSnapshot>>,
  uptime = 0,
) {
  return Effect.runPromise(
    service.report().pipe(
      Effect.provideService(HealthRegistryRepository, healthRegistryFake(runOnce)),
      Effect.provideService(UptimeSource, () => uptime),
    ),
  );
}

describe("HealthService", () => {
  it("returns the registry snapshot", async () => {
    const snapshot = healthSnapshot();

    await expect(report(() => Promise.resolve(snapshot))).resolves.toMatchObject({
      info: snapshot.info,
      error: snapshot.error,
      details: snapshot.details,
      indicators: snapshot.indicators,
    });
  });

  it("maps `up` to `ok` and carries the snapshot's timestamp", async () => {
    const result = await report(() => Promise.resolve(healthSnapshot()));

    expect(result.status).toBe("ok");
    expect(result.timestamp).toEqual(new Date("2026-10-09T00:00:00.000Z"));
    expect(result.service).toBe(SERVICE_NAME);
  });

  it("maps `down` to `degraded`", async () => {
    const result = await report(() =>
      Promise.resolve(healthSnapshot({ status: "down", info: {} })),
    );

    expect(result.status).toBe("degraded");
  });

  it("reports the clock's uptime verbatim: seconds, no milliseconds conversion", async () => {
    // `process.uptime()` is already seconds. The bug this catches divided by 1000,
    // so a stub of 42 would arrive as 0.042.
    const result = await report(() => Promise.resolve(healthSnapshot()), 42);

    expect(result.uptime).toBe(42);
  });

  it("maps a registry failure to the domain error", async () => {
    const runOnce = vi.fn(() => Promise.reject(new Error("registry exploded")));

    const message = await Effect.runPromise(
      service.report().pipe(
        Effect.provideService(HealthRegistryRepository, healthRegistryFake(runOnce)),
        Effect.provideService(UptimeSource, () => 0),
        Effect.catchTag("HealthCheckFailed", (error) => Effect.succeed(error.message)),
      ),
    );

    expect(message).toBe("Health registry failed to produce a snapshot");
  });
});
