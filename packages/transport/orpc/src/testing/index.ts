import { call } from "@orpc/server";

/**
 * Call an implemented procedure without a Nest application.
 *
 * Unlike reaching into `~orpc.handler`, this runs the ordered middleware chain
 * (input validation, auth, `withEffectContext`, …) exactly as production does.
 */
export async function callProcedure<TOutput>(
  procedure: unknown,
  input: unknown,
  context: unknown,
): Promise<TOutput> {
  return call(procedure as never, input as never, { context } as never) as Promise<TOutput>;
}

/**
 * Extract the runtime handler from an `@Implement`-produced procedure.
 *
 * Prefer `callProcedure`; this is only for tests that deliberately bypass
 * middleware.
 */
export function getProcedureHandler(
  procedure: unknown,
): (options: unknown) => Promise<unknown> {
  const orpc = (procedure as { "~orpc"?: { handler?: unknown } })["~orpc"];
  const handler = orpc?.handler;

  if (typeof handler !== "function") {
    throw new Error("No handler found on the implemented procedure");
  }

  return handler as (options: unknown) => Promise<unknown>;
}
