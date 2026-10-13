/**
 * Platform ORPC middlewares.
 *
 * `requireAppInstance(appInstances)` verifies the X-App-Instance-Token header against the
 * app_instances store and narrows the context with the instance identity. It follows the
 * same DI-factory pattern as `requireAuth(auth)`: the middleware is the ONLY place that
 * resolves the token, so after it runs `context.appInstance` is guaranteed non-null and
 * handlers never check for absence.
 *
 * `rateLimit` and `readHeader` are NOT here: they are transport infrastructure with no
 * domain vocabulary, and the health surface needs the same limiter. Two implementations of
 * "how many requests may you make" is how one endpoint ends up protected and another not,
 * so they live in core and are re-exported for this module's existing callers.
 */

import { os } from "@orpc/server";
import { standardErrorOptions, STANDARD_DOMAIN_ERROR_DEFS } from "@deployer/orpc-utils";

import type { AppInstanceService } from "@/core/modules/platform-ingress/services/app-instance.service";
import { readHeader, type RequestContext } from "@/core/modules/rate-limit/rate-limit.middleware";

export { rateLimit, readHeader, type RequestContext, type RateLimitOptions } from "@/core/modules/rate-limit/rate-limit.middleware";

export function requireAppInstance(appInstances: AppInstanceService) {
	return os
		.$context<RequestContext>()
		.errors(STANDARD_DOMAIN_ERROR_DEFS)
		.middleware(async ({ context, next, errors }) => {
			const rawToken = readHeader(context.request, "x-app-instance-token");
			if (rawToken === null || rawToken.length === 0) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions("unauthorized", "Missing or invalid X-App-Instance-Token"),
				);
			}
			const instance = await appInstances.verifyByToken(rawToken);
			if (instance === null) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions("unauthorized", "Missing or invalid X-App-Instance-Token"),
				);
			}
			return next({
				context: {
					...context,
					appInstance: {
						id: instance.id,
						label: instance.label,
						kind: instance.kind,
					},
				},
			});
		});
}
