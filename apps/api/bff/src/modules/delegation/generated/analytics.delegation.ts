/**
 * GENERATED — the `analytics` surface, delegated to `identity`.
 *
 * Every method here is a CALL ON A TYPED CLIENT, not a relayed request: the input the
 * handler receives is the one the contract declares, and the client accepts exactly that
 * type. The BFF is a CLIENT of the service — which is what lets the orchestrators call
 * several and join the answers, and what the removed proxy middleware could not do,
 * because it relayed bytes it never parsed.
 *
 * ── WHY THERE IS NO `requireAuth()` HERE ────────────────────────────────────
 * Authorization is a property of the PROCEDURE, and the service enforces it on the leg it
 * receives (it applies `requireAuth()`, `requireMesh()` and role gates to the procedures
 * that need them). Re-applying a blanket session requirement at the BFF would BREAK the
 * procedures that are legitimately public — the health probes, the mesh endpoints, the
 * setup surface — and would put one policy in two places, where the copy that drifts is
 * the one nobody reads. The caller's credentials still travel (see `service-auth-context`),
 * so the service decides with the real session in hand.
 *
 * ── WHY THE CLIENT BINDS THE NAMESPACE CONTRACT ─────────────────────────────
 * `clients.for(service, <namespaceContract>)` — not the service's combined contract. The
 * combined one puts `list`/`findById`/`create`/`update`/`delete` on two namespaces at once
 * (project and service both declare them), so its client omits those from the root type and
 * `this.client.list(...)` would not compile. Binding the namespace keeps every call
 * unambiguous by construction, with no aliasing rules to remember.
 *
 * Regenerate with `scripts/gen-bff-delegation.py`; do not hand-edit.
 */

import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { analyticsContract } from "@deployer/identity-contracts";

import { ServiceClientRegistry } from "../../../clients/service-registry";

@Controller()
export class AnalyticsDelegationController {
	constructor(private readonly clients: ServiceClientRegistry) {}

	/** The typed client for the NAMESPACE this controller serves. */
	private get client() {
		return this.clients.for("identity", analyticsContract);
	}

	@Implement(analyticsContract.getResourceMetrics)
	getResourceMetrics() {
		return implement(analyticsContract.getResourceMetrics).handler(({ input }) => this.client.getResourceMetrics(input));
	}

	@Implement(analyticsContract.getApplicationMetrics)
	getApplicationMetrics() {
		return implement(analyticsContract.getApplicationMetrics).handler(({ input }) => this.client.getApplicationMetrics(input));
	}

	@Implement(analyticsContract.getDatabaseMetrics)
	getDatabaseMetrics() {
		return implement(analyticsContract.getDatabaseMetrics).handler(({ input }) => this.client.getDatabaseMetrics(input));
	}

	@Implement(analyticsContract.getDeploymentMetrics)
	getDeploymentMetrics() {
		return implement(analyticsContract.getDeploymentMetrics).handler(({ input }) => this.client.getDeploymentMetrics(input));
	}

	@Implement(analyticsContract.getServiceHealth)
	getServiceHealth() {
		return implement(analyticsContract.getServiceHealth).handler(({ input }) => this.client.getServiceHealth(input));
	}

	@Implement(analyticsContract.getRealTimeMetrics)
	getRealTimeMetrics() {
		return implement(analyticsContract.getRealTimeMetrics).handler(({ input }) => this.client.getRealTimeMetrics(input));
	}

	@Implement(analyticsContract.getResourceUsage)
	getResourceUsage() {
		return implement(analyticsContract.getResourceUsage).handler(({ input }) => this.client.getResourceUsage(input));
	}

	@Implement(analyticsContract.getUserActivity)
	getUserActivity() {
		return implement(analyticsContract.getUserActivity).handler(({ input }) => this.client.getUserActivity(input));
	}

	@Implement(analyticsContract.getActivitySummary)
	getActivitySummary() {
		return implement(analyticsContract.getActivitySummary).handler(({ input }) => this.client.getActivitySummary(input));
	}

	@Implement(analyticsContract.getApiUsage)
	getApiUsage() {
		return implement(analyticsContract.getApiUsage).handler(({ input }) => this.client.getApiUsage(input));
	}

	@Implement(analyticsContract.getDeploymentUsage)
	getDeploymentUsage() {
		return implement(analyticsContract.getDeploymentUsage).handler(({ input }) => this.client.getDeploymentUsage(input));
	}

	@Implement(analyticsContract.getStorageUsage)
	getStorageUsage() {
		return implement(analyticsContract.getStorageUsage).handler(({ input }) => this.client.getStorageUsage(input));
	}

	@Implement(analyticsContract.generateReport)
	generateReport() {
		return implement(analyticsContract.generateReport).handler(({ input }) => this.client.generateReport(input));
	}

	@Implement(analyticsContract.getReport)
	getReport() {
		return implement(analyticsContract.getReport).handler(({ input }) => this.client.getReport(input));
	}

	@Implement(analyticsContract.listReports)
	listReports() {
		return implement(analyticsContract.listReports).handler(({ input }) => this.client.listReports(input));
	}

	@Implement(analyticsContract.deleteReport)
	deleteReport() {
		return implement(analyticsContract.deleteReport).handler(({ input }) => this.client.deleteReport(input));
	}

	@Implement(analyticsContract.downloadReport)
	downloadReport() {
		return implement(analyticsContract.downloadReport).handler(({ input }) => this.client.downloadReport(input));
	}

	@Implement(analyticsContract.createReportConfig)
	createReportConfig() {
		return implement(analyticsContract.createReportConfig).handler(({ input }) => this.client.createReportConfig(input));
	}

	@Implement(analyticsContract.listReportConfigs)
	listReportConfigs() {
		return implement(analyticsContract.listReportConfigs).handler(({ input }) => this.client.listReportConfigs(input));
	}

	@Implement(analyticsContract.updateReportConfig)
	updateReportConfig() {
		return implement(analyticsContract.updateReportConfig).handler(({ input }) => this.client.updateReportConfig(input));
	}

	@Implement(analyticsContract.deleteReportConfig)
	deleteReportConfig() {
		return implement(analyticsContract.deleteReportConfig).handler(({ input }) => this.client.deleteReportConfig(input));
	}
}
