import type { ORPCAuthContext } from "../modules/auth/orpc/types";

/**
 * The oRPC context every API app's handlers and middlewares see.
 *
 * ── WHY THIS AUGMENTATION LIVES IN `shared`, NOT IN AN APP ──────────────────
 * TypeScript module augmentation is GLOBAL to a compilation, and the shared
 * platform code (mesh controller, auth middlewares, the ORPC host) is compiled
 * as part of EVERY app. If each app declared this interface on its own, the
 * shared code would be checked against an un-augmented `DefaultInitialContext`
 * and every `context.request` / `context.auth` access inside it would fail —
 * which is exactly what happened when the augmentation lived in
 * `apps/api/src/app.module.ts` and `shared` was type-checked without it.
 *
 * Declaring it once here means the shared code and every app agree by
 * construction, and a new app gets the right context by depending on the
 * package rather than by remembering to copy an interface.
 *
 * ── WHAT IS DELIBERATELY NOT DECLARED ───────────────────────────────────────
 * Per-request data that is NOT universally guaranteed (the auth session, the
 * app-instance identity) is narrowed in by per-route middlewares
 * (`requireAuth`, `requireAppInstance`) rather than declared here, so a handler
 * can rely on its presence without a null check. Declaring it optional here
 * would invite `context.auth.user?.id`, which is the bug that pattern causes.
 *
 * The index signatures (string and symbol) are required for compatibility with
 * oRPC's internal `MergedInitialContext` types.
 */
declare module "@orpc/server" {
	// ── MUST BE `interface`, NOT `type` ─────────────────────────────────────
	// A `type` alias is a fresh declaration, so redeclaring `DefaultInitialContext`
	// as a type in a module augmentation is `TS2300: Duplicate identifier`, and
	// TypeScript then DISCARDS the augmentation — leaving every `context.auth`
	// access typed against the un-augmented default.
	//
	// `interface` MERGES with the existing declaration instead, which is the only
	// form module augmentation supports for a type. The monolith
	// (`apps/api/src/core/orpc/context.ts`) always used `interface`; this copy
	// drifted to `type`, which is why the BFF reported 30+ type errors in files
	// that are byte-identical to monolith ones that type-check cleanly.
	interface DefaultInitialContext {
		request: Request;
		auth: ORPCAuthContext;
		[key: string]: unknown;
		[key: symbol]: unknown;
	}
}
