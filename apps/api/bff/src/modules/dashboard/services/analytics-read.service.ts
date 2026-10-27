import { Controller, Injectable, Logger, Module } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import {
	bffAccountOverviewContract,
	bffAnalyticsOverviewContract,
	bffDashboardOverviewContract,
	bffFleetOverviewContract,
	bffListProjectOverviewsContract,
	bffProjectDetailContract,
	bffServiceDetailContract,
} from "@deployer/bff-contracts";
import { analyticsContract } from "@deployer/identity-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ServiceNotFoundError } from "../../shared/errors/service-not-found.error";
import { OverviewComposerService } from "../../shared/services/overview-composer.service";
import { ScreenReadService, type Section, optional } from "../../shared/services/screen-read.service";

/**
 * Reads a service's own contract, so the BFF never re-implements a query it can call.
 *
 * Kept beside the composer because the two are one unit: the composer decides WHICH
 * sources a screen needs, this decides HOW each is reached. A composer that owned
 * its own clients would put the `clientFor(name, contract)` pairing in every screen,
 * and with it the chance of naming the wrong contract for a service.
 */
@Injectable()
export class AnalyticsReadService {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/**
	 * The eight metric families the analytics page charts, read in parallel.
	 *
	 * ── WHY THE WINDOW IS NOT APPLIED TO EVERY READ ────────────────────────
	 * `getActivitySummary` buckets by period (hour/day/week/month), not by a
	 * `timeRange` string, and `getRealTimeMetrics` is a snapshot with no window at
	 * all. Passing `timeRange` to them would be a parameter their schema does not
	 * declare, so each call carries the window its own contract accepts.
	 */
	async overview(timeRange: string) {
		const analytics = this.clients.for("identity", analyticsContract);
		const window = { timeRange: timeRange as never };

		const [activity, apiUsage, application, database, deployments, deploymentUsage, realtime, resources] =
			await Promise.all([
				analytics.getActivitySummary({ query: {} }),
				analytics.getApiUsage({ query: window }),
				analytics.getApplicationMetrics({ query: window }),
				analytics.getDatabaseMetrics({ query: window }),
				analytics.getDeploymentMetrics({ query: window }),
				analytics.getDeploymentUsage({ query: window }),
				analytics.getRealTimeMetrics({ query: {} }),
				analytics.getResourceMetrics({ query: window }),
			]);

		return { activity, apiUsage, application, database, deployments, deploymentUsage, realtime, resources };
	}
}
