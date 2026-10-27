import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { runWithServiceAuth } from "./service-auth-context";

/** The header a caller uses to present a platform-scoped mesh internal key. */
const HDR_MESH_INTERNAL_KEY = "x-mesh-internal-key";

/**
 * Binds the CALLER's credentials to the request, so every fan-out the BFF makes on
 * their behalf is made as them.
 *
 * ── WHY THIS REPLACES THE FORWARDING MIDDLEWARE ─────────────────────────────
 * The old edge copied each inbound request onto the owning service, so the
 * caller's cookie reached the service because the REQUEST did. The BFF no longer
 * relays requests — it calls services itself and composes the answers — so the
 * cookie has to travel by another route. This middleware captures it once, at the
 * only point where the inbound request provably exists, and `ServiceClientRegistry`
 * reads it on each outgoing leg.
 *
 * ── WHY IT IS NOT A GUARD ───────────────────────────────────────────────────
 * A guard runs for CONTROLLER routes only. This must cover the fan-out made by any
 * handler, including ones reached through paths a guard does not wrap, and it must
 * run before anything reads the credentials. Middleware is the layer that holds
 * both properties.
 *
 * ── WHY `next()` IS INSIDE `run()` ──────────────────────────────────────────
 * `AsyncLocalStorage.run` establishes the context for the callback and everything
 * it synchronously (and asynchronously) descends into. Calling `next()` inside it
 * is what makes the rest of the request pipeline — the oRPC handlers that fan out —
 * run inside the store. Seeding it in `onModuleInit` or a controller would be a
 * different (and wrong) lifetime: one store for the process instead of one per
 * request, which is precisely how one caller's session leaks into another's
 * fan-out.
 *
 * An anonymous request is NOT rejected here. Whether a caller must be
 * authenticated is a property of the PROCEDURE, and the services already enforce it
 * on the leg they receive; refusing at the edge would break the public procedures
 * (health, setup, login) that legitimately fan out with no session.
 */
@Injectable()
export class ServiceAuthContextMiddleware implements NestMiddleware {
	use(req: Request, _res: Response, next: NextFunction): void {
		const meshInternalKey = req.headers[HDR_MESH_INTERNAL_KEY];

		runWithServiceAuth(
			{
				// `req.headers.cookie` is a string on Node's request; Better Auth's session
				// lookup needs the raw cookie header, not a parsed map.
				cookie: req.headers.cookie,
				authorization: req.headers.authorization,
				meshInternalKey: Array.isArray(meshInternalKey) ? meshInternalKey[0] : meshInternalKey,
			},
			() => { next(); },
		);
	}
}
