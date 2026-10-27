import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { Planet } from "../src/contracts";
import { PlanetRepository } from "../src/modules/planet/repositories/planet.repository";
import { PlanetServiceImpl } from "../src/modules/planet/services/planet.service";
import { makePlanetRepository } from "./fakes/planet.repository.fake";

/**
 * Effect DI makes the service testable without Nest, HTTP or a database:
 * provide the port with a plain Layer and run the Effect.
 */
const earth: Planet = {
  id: "earth",
  name: "Earth",
  description: null,
  discoveredAt: new Date(0).toISOString(),
};

const service = new PlanetServiceImpl();

describe("PlanetService", () => {
  it("filters and paginates through the injected repository", async () => {
    const layer = Layer.succeed(PlanetRepository, makePlanetRepository([earth]));

    const result = await Effect.runPromise(
      service.list({ limit: 10, search: "ear" }).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual([earth]);
  });

  it("maps a duplicate name to a domain error", async () => {
    const layer = Layer.succeed(PlanetRepository, makePlanetRepository([earth]));

    const outcome = await Effect.runPromise(
      service.create({ name: "earth" }).pipe(
        Effect.catchTag("PlanetNameConflict", (error) => Effect.succeed(`conflict:${error.name}`)),
        Effect.provide(layer),
      ),
    );

    expect(outcome).toBe("conflict:earth");
  });
});
