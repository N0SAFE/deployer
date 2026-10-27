import { Injectable } from "@nestjs/common";
import { Context, Effect } from "effect";
import type { Planet } from "../../../contracts";

export interface NewPlanet {
  name: string;
  description?: string;
}

/**
 * Single-implementation convention: interface, Effect key and implementation
 * live in one file. When a second implementation appears, move each one to
 * `repositories/planet/<name>.repository.ts` and keep this file for the
 * contract only.
 */
export interface PlanetRepositoryShape {
  readonly findAll: () => Effect.Effect<readonly Planet[]>;
  readonly findById: (id: string) => Effect.Effect<Planet | undefined>;
  readonly insert: (input: NewPlanet) => Effect.Effect<Planet>;
}

export class PlanetRepository extends Context.Service<PlanetRepository, PlanetRepositoryShape>()(
  "planet/PlanetRepository",
) {}

@Injectable()
export class InMemoryPlanetRepository implements PlanetRepositoryShape {
  private readonly planets = new Map<string, Planet>(
    (
      [
        ["mercury", "Mercury"],
        ["venus", "Venus"],
        ["earth", "Earth"],
        ["mars", "Mars"],
      ] as const
    ).map(([id, name]) => [
      id,
      {
        id,
        name,
        description: null,
        discoveredAt: new Date(2024, 0, 1).toISOString(),
      },
    ]),
  );

  findAll() {
    return Effect.sync(() => [...this.planets.values()]);
  }

  findById(id: string) {
    return Effect.sync(() => this.planets.get(id));
  }

  /** Persistence owns identity and timestamps, not the domain service. */
  insert(input: NewPlanet) {
    return Effect.sync(() => {
      const planet: Planet = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description ?? null,
        discoveredAt: new Date().toISOString(),
      };
      this.planets.set(planet.id, planet);
      return planet;
    });
  }
}
