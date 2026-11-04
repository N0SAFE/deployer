import { Controller, Get, Inject, Res } from "@nestjs/common";
import { Effect } from "effect";

import { PlatformHealthService, type PlatformHealthServiceShape } from "../services/platform-health.service";

import type { PlatformHealth } from "../platform-health.schema";
import type { Response } from "express";

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
 * ── NOTHING MAY REQUIRE A SESSION HERE ──────────────────────────────────────
 * There is no global guard, so "public" is simply the absence of an auth requirement —
 * and it must stay that way. A `401 UNAUTHORIZED` is the worst possible shape for a
 * probe: the endpoint exists, the aggregate is computed, and every caller is told the
 * platform is unauthorized. Setup's handover polls the BFF for readiness, and an
 * operator polling this to confirm the tier came up would conclude the tier was down.
 */
@Controller("health")
export class PlatformHealthController {
	constructor(@Inject(PlatformHealthService) private readonly health: PlatformHealthServiceShape) {}

	@Get("platform")
	async platform(): Promise<PlatformHealth> {
		return Effect.runPromise(this.health.getHealth());
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
	async ready(@Res({ passthrough: true }) res: Response): Promise<PlatformHealth | { message: string; platform: PlatformHealth }> {
		const health = await Effect.runPromise(this.health.getHealth());
		if (health.state !== "healthy") {
			res.status(503);
			return { message: "The platform tier is not ready", platform: health };
		}
		return health;
	}
}
