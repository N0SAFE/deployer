import { Controller } from "@nestjs/common";
import { implement } from "@orpc/server";
import { Effect } from "effect";
import { planetContract } from "../../contracts/planet.contract";
import { Implement } from "@orpc/nest";
import { requireSession } from "../../orpc/require-session";
import { PlanetService } from "./services/planet.service";

/**
 * No constructor, no `@Inject`: every dependency is an Effect service resolved
 * from `effect/context`. Requirements come from the handler body (`yield*
 * PlanetService`) and the oRPC middleware chain (`requireSession`).
 */
@Controller()
export class PlanetController {
  @Implement(planetContract.list)
  list() {
    return implement(planetContract.list).effect(function* ({ input }) {
      const planets = yield* PlanetService;
      return yield* planets.list(input);
    });
  }

  @Implement(planetContract.findById)
  findById() {
    return implement(planetContract.findById).effect(function* ({ input, errors }) {
      const planets = yield* PlanetService;
      const planet = yield* planets.findById(input.id);

      if (!planet) {
        return yield* Effect.fail(errors.NOT_FOUND({ data: { id: input.id } }));
      }

      return planet;
    });
  }

  @Implement(planetContract.create)
  create() {
    return implement(planetContract.create)
      .use(requireSession)
      .effect(function* ({ input, errors, context }) {
        const planets = yield* PlanetService;

        const planet = yield* planets.create(input).pipe(
          // Domain error → transport error, at the boundary only.
          Effect.catchTag("PlanetNameConflict", (error) =>
            Effect.fail(errors.CONFLICT({ data: { name: error.name } })),
          ),
        );

        // Response Headers Plugin: merged into the real HTTP response.
        context.resHeaders?.set("x-created-by", context.auth.user.email);

        return planet;
      });
  }
}
