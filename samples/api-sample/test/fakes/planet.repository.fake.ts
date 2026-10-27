import { Effect } from "effect";
import type { Planet } from "../../src/contracts";
import type {
  NewPlanet,
  PlanetRepositoryShape,
} from "../../src/modules/planet/repositories/planet.repository";

/** Test double for the repository port. Lives in `test/`, never in `src/`. */
export function makePlanetRepository(planets: Planet[] = []): PlanetRepositoryShape {
  return {
    findAll: () => Effect.succeed(planets),
    findById: (id) => Effect.succeed(planets.find((planet) => planet.id === id)),
    insert: (input: NewPlanet) =>
      Effect.succeed({
        id: `generated-${input.name}`,
        name: input.name,
        description: input.description ?? null,
        discoveredAt: new Date(0).toISOString(),
      }),
  };
}
