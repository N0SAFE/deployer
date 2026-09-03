/**
 * PlatformController — ORPC implementation of the platform surface.
 *
 * Public:   registerAppInstance (credential-gated, rate-limited via middleware),
 *           heartbeatAppInstance (token verified via requireAppInstance
 *           middleware; header typed through detailed input).
 * Admin:    list/revoke instances (requireAuth).
 *
 * The HTML management console lives in PlatformConsoleController.
 */

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { standardErrorOptions } from "@repo/orpc-utils";

import {
	heartbeatAppInstanceContract,
	listAppInstancesContract,
	registerAppInstanceContract,
	revokeAppInstanceContract,
} from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { AuthCoreService } from "@/core/modules/auth/services/auth-core.service";
import {
	AppInstanceService,
	STALE_AFTER_MS,
} from "@/core/modules/platform-ingress/services/app-instance.service";
import { rateLimit, requireAppInstance } from "../orpc/middlewares";

/** Registration rate limit: sliding window per source IP. */
const REGISTER_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 } as const;

@Controller()
export class PlatformController {
	constructor(
		private readonly appInstances: AppInstanceService,
		private readonly authCoreService: AuthCoreService,
	) {}

	@AllowAnonymous()
	@Implement(registerAppInstanceContract)
	register() {
		return implement(registerAppInstanceContract)
			.use(rateLimit({
				...REGISTER_RATE_LIMIT,
				message: "Too many registration attempts — try again later",
			}))
			.handler(async ({ input, errors }) => {
				// Verify the account exists on THIS API — the anti-abuse boundary:
				// only legitimate account holders can introduce web instances.
				try {
					await this.authCoreService.api.signInEmail({
						body: { email: input.email, password: input.password },
					});
				} catch (error) {
					// Log the underlying cause (request-id correlated) — never
					// swallow infrastructure failures as "bad credentials".
					const detail =
						error instanceof Error ? error.message : String(error);
					console.error(
						`[registerAppInstance] credential verification failed: ${detail}`,
					);
					throw errors.UNAUTHORIZED(
						standardErrorOptions("unauthorized", "Invalid account credentials"),
					);
				}

				const minted = await this.appInstances.create({
					label: input.instanceLabel,
					kind: "external",
				});

				return {
					status: 201,
					body: {
						instanceId: minted.instanceId,
						appToken: minted.appToken,
						heartbeatIntervalMs: Math.floor(STALE_AFTER_MS / 3),
					},
				};
			});
	}

	@AllowAnonymous()
	@Implement(heartbeatAppInstanceContract)
	heartbeat() {
		// `requireAppInstance` resolves the token and narrows the context:
		// after it, `context.appInstance` is guaranteed present — never
		// null-checked in the handler.
		return implement(heartbeatAppInstanceContract)
			.use(requireAppInstance(this.appInstances))
			.handler(async () => {
				return {
					status: 201,
					body: { renewUntil: new Date(Date.now() + STALE_AFTER_MS) },
				};
			});
	}

	@Implement(listAppInstancesContract)
	list() {
		return implement(listAppInstancesContract)
			.use(requireAuth())
			.handler(async () => {
				await this.appInstances.sweepStale();
				const instances = await this.appInstances.list();
				return {
					instances: instances.map((row) => ({
						id: row.id,
						label: row.label,
						kind: row.kind,
						status: row.status,
						lastSeenAt: row.lastSeenAt,
						createdAt: row.createdAt,
					})),
				};
			});
	}

	@Implement(revokeAppInstanceContract)
	revoke() {
		return implement(revokeAppInstanceContract)
			.use(requireAuth())
			.handler(async ({ input }) => {
				// Delete verbs envelope the input: body + default params.
				return { revoked: await this.appInstances.revoke(input.body.instanceId) };
			});
	}
}
