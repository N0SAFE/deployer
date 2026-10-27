import type { WithEffectContext } from "@orpc/effect";
import type {
  RequestHeadersHandlerPluginContext,
  ResponseHeadersHandlerPluginContext,
} from "@orpc/server/plugins";
import type { Request } from "express";
import type { AppServices } from "../effect/runtime";
import type { AuthContext } from "../auth/auth-context";

/**
 * Shape of the context every procedure receives.
 *
 * - `request` (and its middleware-populated `session`) comes from Nest.
 * - `auth` is the discriminated auth context derived from that session.
 * - `reqHeaders` / `resHeaders` are injected by the oRPC header plugins.
 * - `effect/context` is the ManagedRuntime context, so `yield* PlanetRepository`
 *   works in any `.effect(...)` handler.
 */
export interface AppContext
  extends WithEffectContext<AppServices>,
    RequestHeadersHandlerPluginContext,
    ResponseHeadersHandlerPluginContext {
  request: Request;
  auth: AuthContext;
}

/**
 * Teach `implement(...)` about the custom context. Without this augmentation
 * `implement(contract.planet.list)` thinks the context is `{}` and neither
 * `context.request` nor the Effect services would type-check.
 */
declare module "@orpc/server" {
  interface DefaultInitialContext extends AppContext {}
}
