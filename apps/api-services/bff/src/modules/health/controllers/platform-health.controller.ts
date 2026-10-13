import { Controller, Get } from "@nestjs/common";

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
 */
@Controller("health")
export class PlatformHealthController {
	constructor(private readonly health: PlatformHealthService) {}

	@Get("platform")
	async platform(): Promise<PlatformHealth> {
		return this.health.getHealth();
	}
}
