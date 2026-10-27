import type { Context } from "effect";

/**
 * Builds the `'effect/context'` slice of an oRPC handler context.
 *
 * ```ts
 * const context = effectContext(
 *   Context.empty().pipe(Context.add(HealthService, service)),
 * );
 * await callProcedure(controller.check(), {}, context);
 * ```
 */
export function effectContext<Services>(context: Context.Context<Services>) {
  return { "effect/context": context };
}
