/**
 * The API's oRPC context type names.
 *
 * oRPC v2 renamed the augmentable global context: v1 had `ORPCGlobalContext` in
 * `@orpc/nest`, v2 has `DefaultInitialContext` in `@orpc/server`, and
 * `Implement()` resolves that interface directly. `app.module.ts` augments
 * `DefaultInitialContext`, so the type every handler sees IS that interface.
 *
 * `ORPCGlobalContext` is kept as an app-local alias rather than a re-export
 * from the framework, because the framework no longer exports it. Consumers
 * import from here, so there is exactly one name for "the API's oRPC context"
 * and a future framework rename has one place to change.
 */
import type { DefaultInitialContext } from "@orpc/server";

/** The API's oRPC initial context (augmented in `app.module.ts`). */
export type ORPCGlobalContext = DefaultInitialContext;
