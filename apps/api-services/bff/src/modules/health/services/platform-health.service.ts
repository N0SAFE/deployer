import { Injectable } from "@nestjs/common";

import { API_SERVICE_NAMES, apiServiceUrl, type ApiServiceName } from "@deployer/shared/server";
import type { PlatformHealth, ServiceHealth } from "../platform-health.schema";

/**
 * The platform health roll-up.
 *
 * ── THIS IS THE BFF DOING ITS JOB, NOT PROXYING ─────────────────────────────
 * No service exposes "platform health". Each exposes its OWN `/health/ready`, which
 * answers a local question ("are my dependencies usable?"). The question an OPERATOR
 * has is different — "is the platform fine?" — and it is a join across every service
 * plus a verdict. That join is exactly the front-facing composition the BFF owns,
 * and it is why `deployer status` reads one endpoint here instead of fanning out
 * itself.
 *
 * ── WHY IT PROBES READINESS, NOT JUST REACHABILITY ──────────────────────────
 * A service that is up but not ready is the failure this class exists to surface: a
 * TCP connect would call it healthy and the operator would see a green dashboard
 * while requests fail. `/health/ready` is the 503-until-ready gate the shared server
 * binds (preflight), so probing it is probing the real answer.
 */
@Injectable()
export class PlatformHealthService {
	async getHealth(): Promise<PlatformHealth> {
		const results = await Promise.all(API_SERVICE_NAMES.map((name) => this.probe(name)));

		// Three states, not a boolean — see `platformHealthSchema`. `latencyMs` is what
		// tells "did not answer" apart from "answered with a failure": only a response
		// sets it.
		const reachable = results.filter((result) => result.latencyMs !== undefined);
		const state =
			reachable.length === 0
				? "unreachable"
				: results.every((result) => result.healthy)
					? "healthy"
					: "degraded";

		return { state, services: results, checkedAt: new Date().toISOString() };
	}

	private async probe(name: ApiServiceName): Promise<ServiceHealth> {
		const url = apiServiceUrl(name);
		const started = Date.now();

		try {
			const response = await fetch(`${url}/health/ready`, {
				// Bounded: a hung service must not hang the roll-up, or `deployer status`
				// would be unusable in exactly the situation it is needed.
				signal: AbortSignal.timeout(3_000),
			});
			const latencyMs = Date.now() - started;

			if (response.ok) {
				return { name, healthy: true, url, latencyMs };
			}
			return {
				name,
				healthy: false,
				url,
				latencyMs,
				reason:
					response.status === 503
						? "not ready (starting or a dependency is down)"
						: `HTTP ${String(response.status)}`,
			};
		} catch (error: unknown) {
			return {
				name,
				healthy: false,
				url,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}
}
