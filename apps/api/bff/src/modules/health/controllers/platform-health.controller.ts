import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";

import type { PlatformHealth } from "../platform-health.schema";
import { PlatformHealthService } from "../services/platform-health.service";

/**
 * Front-facing health endpoint.
 *
 * On the BFF's OWN port (not under the public contract namespace) for the same
 * reason the services do it: a probe must answer even if the contract modules failed
 * to mount, and the orchestrator reaches it directly on the platform network.
 *
 * Public by design — a readiness endpoint that requires a session always fails,
 * because Compose healthchecks and the ingress have no cookie to present.
 *
 * ── `@AllowAnonymous()` IS WHAT MAKES THAT TRUE ─────────────────────────────
 * The auth guard is GLOBAL, so "public by design" in a comment does nothing on its
 * own. Without the decorator this answered `401 UNAUTHORIZED` — the worst possible
 * shape for a probe: the endpoint exists, the aggregate is computed, and every
 * caller is told the platform is unauthorized. Setup's handover polls the BFF for
 * readiness, and an operator polling this to confirm the tier came up would have
 * concluded the tier was down.
 */
@Controller("health")
@AllowAnonymous()
export class PlatformHealthController {
	constructor(private readonly health: PlatformHealthService) {}

	@Get("platform")
	async platform(): Promise<PlatformHealth> {
		return this.health.getHealth();
	}

	/**
	 * The gate setup waits on: 200 only when EVERY service reports ready.
	 *
	 * ── WHY A SECOND ENDPOINT AND NOT A `?strict=1` FLAG ──────────────────────
	 * They answer different questions with different status codes.
	 * `/health/platform` is a DIAGNOSTIC: always 200, and it describes which
	 * services are down, because "degraded" is information rather than a transport
	 * failure. This one is a GATE: a caller that only wants "may I proceed?" should
	 * not have to parse a body and re-implement the verdict, and a poll loop reads a
	 * status code. 503-until-green is the same contract every per-service
	 * `/health/ready` already uses.
	 */
	@Get("platform/ready")
	async ready(): Promise<PlatformHealth> {
		const health = await this.health.getHealth();
		if (health.state !== "healthy") {
			throw new ServiceUnavailableException({
				message: "The platform tier is not ready",
				platform: health,
			});
		}
		return health;
	}
}
