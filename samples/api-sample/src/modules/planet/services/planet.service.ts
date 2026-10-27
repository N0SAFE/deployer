import { Injectable } from "@nestjs/common";
import { Context, Effect } from "effect";
import type { Planet } from "../../../contracts";
import { PlanetNameConflict } from "../errors/planet-name-conflict";
import { PlanetRepository } from "../repositories/planet.repository";

export interface ListPlanetsInput {
  limit: number;
  search?: string;
}

export interface CreatePlanetInput {
  name: string;
  description?: string;
}

/** Pure selection rule, kept out of the Effect so it stays trivially testable. */
function selectPlanets(planets: readonly Planet[], input: ListPlanetsInput): Planet[] {
  const search = input.search?.trim().toLowerCase();

  return planets
    .filter((planet) => !search || planet.name.toLowerCase().includes(search))
    .slice(0, input.limit);
}

function containsName(planets: readonly Planet[], name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return planets.some((planet) => planet.name.trim().toLowerCase() === normalized);
}

/**
 * Single-implementation convention: interface, Effect key and implementation
 * in one file. Multi-implementation services get a `services/<name>/` folder.
 *
 * Each method is one short `Effect.gen` with a single responsibility, so a
 * failure points at a named step instead of a nested pipe.
 */
export interface PlanetServiceShape {
  readonly list: (input: ListPlanetsInput) => Effect.Effect<Planet[], never, PlanetRepository>;
  readonly findById: (id: string) => Effect.Effect<Planet | undefined, never, PlanetRepository>;
  readonly create: (
    input: CreatePlanetInput,
  ) => Effect.Effect<Planet, PlanetNameConflict, PlanetRepository>;
}

export class PlanetService extends Context.Service<PlanetService, PlanetServiceShape>()(
  "planet/PlanetService",
) {}

@Injectable()
export class PlanetServiceImpl implements PlanetServiceShape {
  list(input: ListPlanetsInput): Effect.Effect<Planet[], never, PlanetRepository> {
    return Effect.gen(function* () {
      const repository = yield* PlanetRepository;
      const planets = yield* repository.findAll();

      return selectPlanets(planets, input);
    });
  }

  findById(id: string): Effect.Effect<Planet | undefined, never, PlanetRepository> {
    return Effect.gen(function* () {
      const repository = yield* PlanetRepository;
      return yield* repository.findById(id);
    });
  }

  create(input: CreatePlanetInput): Effect.Effect<Planet, PlanetNameConflict, PlanetRepository> {
    return Effect.gen(function* () {
      const repository = yield* PlanetRepository;

      const existing = yield* repository.findAll();
      if (containsName(existing, input.name)) {
        return yield* Effect.fail(new PlanetNameConflict({ name: input.name }));
      }

      return yield* repository.insert(input);
    });
  }
}
