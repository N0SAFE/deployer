import { orpc } from '@/lib/orpc'

/**
 * The BFF's SCREEN surface.
 *
 * ── WHY THIS DOMAIN EXISTS ─────────────────────────────────────────────────
 * Every other domain here (`project`, `docker`, `cluster`, …) exposes a SERVICE
 * namespace: the resource as one back end stores it. This one exposes the BFF's
 * own procedures — the ones that answer a SCREEN by fanning out across services
 * and joining the answers.
 *
 * The distinction is the whole point of the split, and the front has been missing
 * it. `dashboardOverview` exists precisely so the landing page does not have to
 * know that a verdict needs cluster nodes (fleet), a deployment list (runtime),
 * a service list (project) and host metrics (identity). Composing that in the
 * browser means the browser knows the service topology, and every screen
 * re-decides the same join.
 *
 * A screen calls `bff.*` when it wants a JOIN, and a service domain when it wants
 * the RESOURCE. Both remain callable — this adds the second option, it does not
 * remove the first.
 */
export const bffEndpoints = {
	/** The operator's landing page: verdict inputs, stats, recent activity, host metrics. */
	dashboardOverview: orpc.bff.dashboardOverview,

	/** The projects list, each already rolled up (service count, health ratio, last deploy). */
	listProjectOverviews: orpc.bff.listProjectOverviews,

	/** One project's screen: the project, its services and its environments in one answer. */
	projectDetail: orpc.bff.projectDetail,

	/** One service's screen: config, domains and latest deployment in one answer. */
	serviceDetail: orpc.bff.serviceDetail,

	/** The analytics screen's eight metric families, read in parallel. */
	analyticsOverview: orpc.bff.analyticsOverview,

	/** The account screen: profile plus notification count. */
	accountOverview: orpc.bff.accountOverview,

	/** The fleet screen: nodes, allocations and admission requests. */
	fleetOverview: orpc.bff.fleetOverview,
}
