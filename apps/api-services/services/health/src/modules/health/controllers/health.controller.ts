import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { healthContract } from "@deployer/health-contracts";
import { HealthRegistry } from "@deployer/shared/server";

/**
 * The health service's oRPC surface.
 *
 * ── THIS IS A THIN TRANSPORT, AND THAT IS THE POINT ─────────────────────────
 * Every method runs the REAL indicator suite (Terminus indicators, live) and
 * returns it. No check is implemented here, and no rule lives here: reading this
 * file tells you which contract procedures exist and nothing else.
 *
 * ── WHY IT RUNS THE CHECKS RATHER THAN READING THE CACHE ────────────────────
 * `healthContract.check` is the CONTRACT's probe — a different question from the
 * container healthcheck. The container probe (`/health/ready`, polled every 15s
 * forever) must be cheap, so it reads the cached verdict. This endpoint is a
 * consumer asking "what is true right now", so it forces a pass. Both read the
 * same registry, so they cannot disagree about what a check MEANS.
 */
@Controller()
export class HealthController {
	constructor(private readonly registry: HealthRegistry) {}

	/**
	 * Liveness + the indicator summary.
	 *
	 * Runs a real pass so the answer is a fact, not a cached opinion.
	 */
	@Implement(healthContract.check)
	check() {
		return implement(healthContract.check).handler(async () => {
			const snapshot = await this.registry.runOnce();

			return {
				status: snapshot.status === "up" ? "ok" : "degraded",
				timestamp: new Date(),
				service: "svc-health",
				// The full per-indicator detail, so a caller does not have to make a
				// second call to learn WHY the status is what it is.
				indicators: snapshot.indicators,
			};
		});
	}

	/**
	 * The detailed report — Terminus' own payload shape.
	 *
	 * `info`/`error`/`details` are passed through UNCHANGED, because that is what
	 * a Terminus client and the Terminus UI already understand. Translating here
	 * would mean every consumer needs the translation too.
	 */
	@Implement(healthContract.detailed)
	detailed() {
		return implement(healthContract.detailed).handler(async () => {
			const snapshot = await this.registry.runOnce();

			return {
				status: snapshot.status === "up" ? "ok" : "degraded",
				timestamp: new Date(),
				service: "svc-health",
				uptime: process.uptime() / 1000,
				// Terminus' payload, untouched.
				info: snapshot.info,
				error: snapshot.error,
				details: snapshot.details,
				// Plus the flattened list, which is what a UI actually renders.
				indicators: snapshot.indicators,
				supervisors: [],
			};
		});
	}
}
