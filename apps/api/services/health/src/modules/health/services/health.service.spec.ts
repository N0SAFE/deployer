import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { HealthRegistryRepository } from "../services/health.service";
import { HealthServiceImpl } from "./health.service";
import { healthRegistryFake, healthSnapshot } from "../testing/health.fixtures";

const service = new HealthServiceImpl();

function check(runOnce: () => Promise<ReturnType<typeof healthSnapshot>>) {
  return Effect.runPromise(
    service.check().pipe(Effect.provideService(HealthRegistryRepository, healthRegistryFake(runOnce))),
  );
}

describe("HealthService", () => {
  it("returns the registry snapshot", async () => {
    const snapshot = healthSnapshot();

    await expect(check(() => Promise.resolve(snapshot))).resolves.toEqual(snapshot);
  });

  it("maps a registry failure to the domain error", async () => {
    const runOnce = vi.fn(() => Promise.reject(new Error("registry exploded")));

    const message = await Effect.runPromise(
      service.check().pipe(
        Effect.provideService(HealthRegistryRepository, healthRegistryFake(runOnce)),
        Effect.catchTag("HealthCheckFailed", (error) => Effect.succeed(error.message)),
      ),
    );

    expect(message).toBe("Health registry failed to produce a snapshot");
  });
});
