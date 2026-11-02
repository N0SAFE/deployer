/**
 * Platform ORPC middlewares.
 *
 * - `requireAppInstance(appInstances)` — verifies the X-App-Instance-Token
 *   header against the app_instances store and narrows the context with the
 *   instance identity. Follows the same DI-factory pattern as
 *   `requireAuth(auth)`: the middleware is the ONLY place that resolves the
 *   token, so after it runs `context.appInstance` is guaranteed non-null —
 *   handlers never check for absence.
 *
 * The generic sliding-window `rateLimit(options)` middleware lives in `@deployer/rate-limit`.
 */

import { os } from "@orpc/server";

import {
    domainErrorOptions,
    standardDomainErrorPayloadSchema,
    standardErrorOptions,
    STANDARD_DOMAIN_ERROR_DEFS,
} from "@deployer/orpc-utils";
import { readHeader, type RequestContext } from "@deployer/rate-limit";
import type { AppInstanceService } from "@deployer/shared/core/modules/platform-ingress/services/app-instance.service";

/** Context extension produced by `requireAppInstance()`. */
export type AppInstanceContext = {
	appInstance: {
		id: string;
		label: string;
		kind: "managed" | "external";
	};
}

/**
 * Verifies the X-App-Instance-Token header and narrows the context with the
 * instance identity. Throws UNAUTHORIZED when the header is missing or the
 * token does not resolve — after this middleware runs, `context.appInstance`
 * is guaranteed present, so handlers never null-check it.
 */
export function requireAppInstance(appInstances: AppInstanceService) {
	return os
		.$context<RequestContext>()
		.errors(STANDARD_DOMAIN_ERROR_DEFS)
		.middleware(async ({ context, next, errors }) => {
			const rawToken = readHeader(context.request, "x-app-instance-token");

			// The two failures mean different things — a client that forgot the header
			// versus a token that no longer resolves — and a single message makes the
			// first indistinguishable from a revoked instance in a log or an e2e run.
			if (rawToken === null || rawToken.length === 0) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions("unauthorized", "Missing X-App-Instance-Token header"),
				);
			}
			const instance = await appInstances.verifyByToken(rawToken);
			if (instance === null) {
				throw errors.UNAUTHORIZED(
					standardErrorOptions(
						"unauthorized",
						"Invalid X-App-Instance-Token: no active instance matches it",
					),
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
