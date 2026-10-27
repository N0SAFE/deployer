import "@orpc/effect/extensions/effect";

import { isDefinedError, safe } from "@orpc/client";
import { Context, Effect } from "effect";
import { call } from "@orpc/server";
import { EMPTY } from "rxjs";
import { describe, expect, it } from "vitest";
import type { Planet } from "../src/contracts";
import { PlanetController } from "../src/modules/planet/planet.controller";
import { PlanetRepository } from "../src/modules/planet/repositories/planet.repository";
import { PlanetService, PlanetServiceImpl } from "../src/modules/planet/services/planet.service";
import { LogStream, type LogStreamShape } from "../src/modules/stream/services/log-stream.service";
import { makePlanetRepository } from "./fakes/planet.repository.fake";

/**
 * `@Implement` only registers routing metadata, so a controller is a plain
 * class: no Nest module, no injected providers. `call` runs validation,
 * middleware, the handler and output validation with a hand-built context.
 */
const earth: Planet = {
  id: "earth",
  name: "Earth",
  description: null,
  discoveredAt: new Date(0).toISOString(),
};

const unusedLogStream: LogStreamShape = { stream: () => Effect.succeed(EMPTY) };

const context = {
  request: {} as never,
  auth: { isLoggedIn: false, session: null, user: null } as const,
  "effect/context": Context.empty().pipe(
    Context.add(PlanetRepository, makePlanetRepository([earth])),
    Context.add(PlanetService, new PlanetServiceImpl()),
    Context.add(LogStream, unusedLogStream),
  ),
};

describe("PlanetController", () => {
  it("resolves its services from the Effect context, not from NestJS", async () => {
    const controller = new PlanetController();

    await expect(call(controller.list(), { limit: 1 }, { context })).resolves.toEqual([earth]);
  });

  it("fails with the contract-defined UNAUTHORIZED error", async () => {
    const controller = new PlanetController();

    const [error] = await safe(call(controller.create(), { name: "Earth" }, { context }));

    expect(isDefinedError(error)).toBe(true);
    if (!isDefinedError(error)) return;
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.data).toEqual({ reason: "missing-session" });
  });
});
