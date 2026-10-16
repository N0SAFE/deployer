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
import { AnalyticsReadService } from "../services/analytics-read.service";

/**
 * The BFF's composition surface.
 *
 * ── WHAT THESE HANDLERS DO, AND WHAT THEY DELIBERATELY DO NOT ───────────────
 * Each one answers a SCREEN: it fans out to the services that own the data, joins
 * the answers, and returns the shape the front renders. None of them forwards the
 * caller's request, and none of them exposes a single service's response as its own
 * — that is the difference between this and the proxy layer it replaces.
 *
 * ── WHY THE ROUTES ARE UNPREFIXED HERE ──────────────────────────────────────
 * The contract's ops object already carries the prefix (`/bff`) and the paths
 * (`/dashboard/overview`). Restating a path in the decorator would create a second
 * place the URL is written, and the one that drifts silently is the decorator —
 * `@Implement` maps the procedure the contract declares, so the decorator only has
 * to be empty for that mapping to be exact.
 */
@Controller()
export class OrchestrationController {
	private readonly logger = new Logger(OrchestrationController.name);

	constructor(
		private readonly reads: ScreenReadService,
		private readonly composer: OverviewComposerService,
		private readonly analytics: AnalyticsReadService,
	) {}

	/**
	 * The operator's landing page, composed from five reads.
	 *
	 * Identity (the operator), project (the list), project (each project's services),
	 * runtime (deployments) and identity-analytics (live metrics).
	 */
	@Implement(bffDashboardOverviewContract)
	dashboardOverview() {
		return implement(bffDashboardOverviewContract)
			.use(requireAuth())
			.handler(async ({ context }) => {
				const userId = context.auth.user.id;
				const sections: Section[] = [];

				// Parallel: these four are independent, so a sequential fan-out would add
				// four latencies where one would do.
				const [operator, projects] = await Promise.all([
					optional(sections, "operator", () => this.reads.findOperator(userId)),
					optional(sections, "projects", () =>
						this.composer.projectOverviews({ limit: 5, offset: 0 }),
					),
				]);

				const overviews = projects?.items ?? [];
				const deploymentRows = await this.reads
					.listDeployments({}, 10)
					.then((page) => page.data)
					.catch(() => []);

				// ── THE HOST METRICS COME FROM ANALYTICS, NOT FROM NOWHERE ─────────
				// This used to be a hardcoded `{ available: false, cpu: null, … }` with a
				// comment claiming system metrics were "deliberately reported as unavailable
				// rather than faked from the deployment counts". That reasoning was about
				// the WRONG SOURCE — the values are not derived from deployment counts, they
				// are read from the host by `svc-identity` (`systeminformation`, reported
				// with `dataSource: "docker"`), and the front already renders them.
				//
				// Declaring them unavailable made the landing page disagree with the very
				// data it could reach, so the panel read "no data source" on a machine that
				// was reporting its CPU.
				const realtime = await this.analytics
					.overview("1h")
					.then((data) => data.realtime)
					.catch(() => null);
				const hostMetrics =
					realtime?.dataSource === "docker"
						? {
								available: true,
								cpu: realtime.system.cpu,
								memory: realtime.system.memory,
								disk: realtime.system.disk,
							}
						: { available: false, cpu: null, memory: null, disk: null };

				const recentActivity = deploymentRows.map((deployment) => ({
					id: deployment.id,
					kind: "deployment" as const,
					title: `Deployment ${deployment.status}`,
					subtitle: deployment.containerName ?? undefined,
					status: deployment.status,
					at: deployment.createdAt,
				}));

				const succeeded = deploymentRows.filter((d) => d.status === "success").length;

				return {
					operator: {
						id: operator?.id ?? userId,
						name: operator?.name ?? "Operator",
						email: operator?.email ?? "",
					},
					stats: this.composer.buildStats({
						projects: projects?.total ?? 0,
						services: overviews.reduce((sum, row) => sum + row.serviceCount, 0),
						deployments: deploymentRows.length,
						failed: deploymentRows.filter((d) => d.status === "failed").length,
					}),
					recentActivity,
					projects: overviews.map((row) => ({
						project: row.project,
						serviceCount: row.serviceCount,
						deploymentCount: row.deploymentCount,
						lastDeployedAt: row.lastDeployedAt,
						healthRatio: row.healthRatio,
					})),
					system: hostMetrics,
					sections: [...sections, ...(projects?.sections ?? [])],
					generatedAt: new Date().toISOString(),
				};
			});
	}

	/** A page of projects, each with its roll-up. */
	@Implement(bffListProjectOverviewsContract)
	listProjectOverviews() {
		return implement(bffListProjectOverviewsContract)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const result = await this.composer.projectOverviews({
					limit: input.query?.limit ?? 20,
					offset: input.query?.offset ?? 0,
					search: input.query?.search,
				});

				return {
					items: result.items.map((row) => ({
						project: row.project,
						serviceCount: row.serviceCount,
						deploymentCount: row.deploymentCount,
						lastDeployedAt: row.lastDeployedAt,
						healthRatio: row.healthRatio,
					})),
					total: result.total,
					hasMore: result.hasMore,
				};
			});
	}

	/** One project's detail screen. */
	@Implement(bffProjectDetailContract)
	projectDetail() {
		return implement(bffProjectDetailContract)
			.use(requireAuth())
			.handler(async ({ input, errors }) => {
				const projectId = input.params.projectId;
				const project = await this.reads.findProject(projectId);
				if (project === null) {
					// The service answers `null` for an unknown project; the BFF is what turns
					// that into the 404 the front branches on.
					throw errors.NOT_FOUND();
				}

				const rollUps = await this.composer.serviceRollUps(projectId);
				const succeeded = rollUps.services.filter(
					(row) => row.lastDeploymentStatus === "success",
				).length;

				return {
					project,
					services: rollUps.services,
					domains: rollUps.domains,
					stats: this.composer.buildStats({
						services: rollUps.services.length,
						succeeded,
						failed: rollUps.services.filter((row) => row.lastDeploymentStatus === "failed")
							.length,
						domains: rollUps.domains.length,
					}),
				};
			});
	}

	/** One service's detail screen. */
	@Implement(bffServiceDetailContract)
	serviceDetail() {
		return implement(bffServiceDetailContract)
			.use(requireAuth())
			.handler(async ({ input, errors }) => {
				try {
					const detail = await this.composer.serviceDetail(input.params.serviceId);
					return {
						service: detail.service,
						projectId: detail.projectId,
						lastDeployment: detail.lastDeployment,
						recentDeployments: detail.recentDeployments,
						primaryDomain: detail.primaryDomain,
						stats: detail.stats,
					};
				} catch (error: unknown) {
					if (error instanceof ServiceNotFoundError) {
						throw errors.NOT_FOUND();
					}
					throw error;
				}
			});
	}

	 /**
	 * The analytics page, composed from the families it charts.
	 *
	 * ── WHY EVERY FAMILY IS INDEPENDENTLY OPTIONAL ──────────────────────────
	 * Each is its own service call. Failing the whole page because the realtime
	 * snapshot is down would hide six working charts — so the fan-out is recorded
	 * under `optional` and the page reports which source is missing.
	 */
	@Implement(bffAnalyticsOverviewContract)
	analyticsOverview() {
		return implement(bffAnalyticsOverviewContract)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const timeRange = input.query.timeRange;
				const sections: Section[] = [];

				const data = await optional(sections, "analytics", () =>
					this.analytics.overview(timeRange),
				);

				return {
					timeRange,
					activity: data?.activity ?? null,
					apiUsage: data?.apiUsage ?? null,
					application: data?.application ?? null,
					database: data?.database ?? null,
					deployments: data?.deployments ?? null,
					deploymentUsage: data?.deploymentUsage ?? null,
					realtime: data?.realtime ?? null,
					resources: data?.resources ?? null,
					sections,
				};
			});
	}

	/**
	 * The operator's profile plus what the app shell renders beside it.
	 *
	 * ── WHY THERE IS NO FALLBACK WHEN THE READ FAILS ────────────────────────
	 * This screen has exactly ONE source, so "degrade gracefully" has no meaning: there
	 * is nothing to render it beside. The earlier version substituted the session's user
	 * object, which is a DIFFERENT shape (it carries the auth plugin's own fields) — and
	 * answering with it would have published a payload that does not match the contract,
	 * which the client's own parse would then reject. A missing or unreadable operator is
	 * an error here, and the front handles it as one.
	 */
	@Implement(bffAccountOverviewContract)
	accountOverview() {
		return implement(bffAccountOverviewContract)
			.use(requireAuth())
			.handler(async ({ context, errors }) => {
				// The session proves the user EXISTS (the BFF resolved it), so `null` here
				// means the identity service could not answer — not that the caller is
				// unknown. Either way there is no profile to return, and a NOT_FOUND is the
				// honest response rather than a fabricated one.
				const user = await this.reads.findOperator(context.auth.user.id);
				if (user === null) {
					throw errors.NOT_FOUND();
				}

				return {
					user,
					// Counting notifications would need a push-service read; 0 is the honest
					// answer until the shell actually renders the badge.
					notificationCount: 0,
					stats: this.composer.buildStats({}),
				};
			});
	}

	/** The device/CLI view: the flat service list with its status. */
	@Implement(bffFleetOverviewContract)
	fleetOverview() {
		return implement(bffFleetOverviewContract)
			.use(requireAuth())
			.handler(async () => {
				const sections: Section[] = [];

				const projects = await optional(sections, "projects", () =>
					this.reads.listProjects({ limit: 100, offset: 0 }),
				);

				const perProject = await Promise.all(
					(projects?.data ?? []).map((project) =>
						this.composer.serviceRollUps(project.id).catch(() => ({
							services: [],
							domains: [],
							sections: [],
						})),
					),
				);

				const services = perProject.flatMap((result) => result.services);
				const succeeded = services.filter((row) => row.lastDeploymentStatus === "success").length;

				return {
					services,
					stats: this.composer.buildStats({
						services: services.length,
						succeeded,
						failed: services.filter((row) => row.lastDeploymentStatus === "failed").length,
					}),
					generatedAt: new Date().toISOString(),
				};
			});
	}
}
