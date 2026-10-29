import { Effect } from "effect";

import { isMissingScanTableError } from "./scan-storage";

let warned = false;

/**
 * A database that has not run the scan-table migration yet behaves as if nothing was ever scanned: the failure is
 * replaced by `fallback` and logged once, instead of failing every call until migrations are applied.
 */
export const tolerateMissingScanTable =
  <B>(fallback: B) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A | B, E, R> =>
    effect.pipe(
      Effect.catchIf(
        (error: E) => isMissingScanTableError(error),
        () =>
          Effect.gen(function* () {
            if (!warned) {
              warned = true;
              yield* Effect.logWarning(
                "Table docker_image_security_scans is missing. Docker image security scan cache will be skipped until database migrations are applied.",
              );
            }
            return fallback;
          }),
      ),
    );
