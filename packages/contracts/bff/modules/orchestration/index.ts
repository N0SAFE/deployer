import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";
import {
	deploymentSchema,
	projectSchema,
	serviceObjectShape,
	userSchema,
} from "@deployer/contracts-entities";
import {
	analyticsActivitySummaryOutputSchema,
	analyticsApiUsageOutputSchema,
	analyticsApplicationMetricsOutputSchema,
	analyticsDatabaseMetricsOutputSchema,
	analyticsDeploymentMetricsOutputSchema,
	analyticsDeploymentUsageOutputSchema,
	analyticsRealtimeMetricsOutputSchema,
	analyticsResourceMetricsOutputSchema,
	// ── THE WINDOW IS THE SERVICE'S, NOT OURS ──────────────────────────────
	// This contract used `z.string().default("24h")`, and `"24h"` is not in the
	// enum `identity` actually accepts (`1h|6h|12h|1d|3d|7d|30d|90d|1y`). The
	// BFF therefore forwarded a window the service rejected, and the whole
	// overview silently degraded to eight nulls:
	//
	//   GET /analytics/overview → 200
	//   { "sections": [{ "name": "analytics", "ok": false,
	//                    "reason": "Input validation failed" }], …all null }
	//
	// Reusing the service's own schema makes that unrepresentable: the default
	// and the accepted set are defined once, where the service enforces them.
	timeRangeSchema,
} from "@deployer/identity-contracts";
import {
	enableManagedWebTunnelInputSchema,
	enableManagedWebTunnelOutputSchema,
	managedWebActionOutputSchema,
	managedWebStateOutputSchema,
	setManagedWebOriginInputSchema,
	setManagedWebOriginOutputSchema,
} from "@deployer/fleet-contracts";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * The BFF's SCREEN contract — how the front asks for a screen's worth of data.
 *
 * ── WHY THIS IS NOT THE SERVICE CONTRACTS ───────────────────────────────────
 * A service owns ONE bounded context and exposes it as CRUD. A screen needs
 * several of them AT ONCE, joined into the shape it renders. Those are different
 * contracts, and conflating them is what turns a BFF into a proxy:
 *
 *   the dashboard shows a project count, a service count, recent deployments and
 *   live system metrics — four services. Making the browser fetch four endpoints
 *   and join them itself makes the page flicker, puts the join inside a
 *   component, and leaks the service topology into the front.
 *
 * Each procedure here is therefore ONE unit of work a screen needs, not one unit
 * of storage. That is the difference between an orchestrator and a proxy.
 *
 * ── WHY THE OUTPUTS ARE DECLARED HERE, NOT REUSED WHOLESALE ─────────────────
 * The ENTITY schemas are shared — they are the data (`projectSchema`,
 * `serviceSchema`, `deploymentSchema`, `userSchema`). The COMPOSITION — which
 * fields, joined how, in what order — is this file's decision. Reusing a
 * service's entire response type as an output would make that service's private
 * response shape accidentally public: renaming a field for the service's own
 * reasons would silently change the front's API.
 *
 * ── WHY `sections` IS IN EVERY MULTI-SOURCE PAYLOAD ─────────────────────────
 * A dashboard that 500s because one of its four sources is down is WORSE than
 * one that renders three panels and names the fourth as unavailable. Each
 * multi-source procedure reports per-source status rather than converting a
 * partial failure into a total one.
 */

/** A count plus the label to render, so the wording has a single owner. */
const statSchema = z.object({
	key: z.string(),
	label: z.string(),
	value: z.number(),
	/** Set when the value could not be read, so a card shows WHY not a bare 0. */
	unavailableReason: z.string().optional(),
});

/** Per-source outcome, so a partial failure degrades instead of failing. */
const sectionSchema = z.object({
	name: z.string(),
	ok: z.boolean(),
	reason: z.string().optional(),
});

/**
 * One row of "recent activity" — deliberately service-agnostic.
 *
 * A timeline mixes deployments, project creations and domain verifications. The
 * front renders ONE list; making it branch on four entity types would push
 * service knowledge into the view.
 */
const activityEntrySchema = z.object({
	id: z.string(),
	kind: z.enum(["deployment", "project", "service", "domain"]),
	title: z.string(),
	subtitle: z.string().optional(),
	status: z.string(),
	at: z.string(),
	href: z.string().optional(),
});

/** A service plus the deployment facts a project row shows beside it. */
const serviceWithStatusSchema = z.object({
	service: serviceObjectShape,
	/** Latest deployment status, or null when the service never deployed. */
	lastDeploymentStatus: z.string().nullable(),
	lastDeployedAt: z.string().nullable(),
	/** Hostname the service answers on, when it has one. */
	primaryDomain: z.string().nullable(),
});

/** A project plus its roll-up — which no single service holds. */
const projectOverviewSchema = z.object({
	project: projectSchema,
	serviceCount: z.number(),
	deploymentCount: z.number(),
	lastDeployedAt: z.string().nullable(),
	/** Share of services whose latest deployment succeeded, 0-1, null when none. */
	healthRatio: z.number().nullable(),
});

const projectDetailSchema = z.object({
	project: projectSchema,
	services: z.array(serviceWithStatusSchema),
	domains: z.array(z.string()),
	stats: z.array(statSchema),
});

const serviceDetailSchema = z.object({
	// Non-null on the wire: `service.crud.findById` answers null for an unknown id and
	// the composer turns that into a 404, so a response that arrives HAS a service.
	service: serviceObjectShape,
	projectId: z.string().nullable(),
	lastDeployment: deploymentSchema.nullable(),
	recentDeployments: z.array(deploymentSchema),
	primaryDomain: z.string().nullable(),
	stats: z.array(statSchema),
});

const dashboardOverviewSchema = z.object({
	operator: z.object({
		id: z.string(),
		name: z.string(),
		email: z.string(),
	}),
	stats: z.array(statSchema),
	recentActivity: z.array(activityEntrySchema),
	projects: z.array(projectOverviewSchema),
	system: z.object({
		available: z.boolean(),
		cpu: z.number().nullable(),
		memory: z.number().nullable(),
		disk: z.number().nullable(),
	}),
	sections: z.array(sectionSchema),
	generatedAt: z.string(),
});

const projectOverviewListSchema = z.object({
	items: z.array(projectOverviewSchema),
	total: z.number(),
	hasMore: z.boolean(),
});

// Declared AFTER the schemas they name, because each `standard.zod` call needs the
// entity to derive its id field and operation summaries from.
const consoleStateOps = standard.zod(managedWebStateOutputSchema, "consoleWebState");
const consoleActionOps = standard.zod(managedWebActionOutputSchema, "consoleWebAction");
const consoleOriginOps = standard.zod(setManagedWebOriginOutputSchema, "consoleWebOrigin");

const analyticsOverviewSchema = z.object({
	timeRange: z.string(),
	activity: analyticsActivitySummaryOutputSchema.nullable(),
	apiUsage: analyticsApiUsageOutputSchema.nullable(),
	application: analyticsApplicationMetricsOutputSchema.nullable(),
	database: analyticsDatabaseMetricsOutputSchema.nullable(),
	deployments: analyticsDeploymentMetricsOutputSchema.nullable(),
	deploymentUsage: analyticsDeploymentUsageOutputSchema.nullable(),
	realtime: analyticsRealtimeMetricsOutputSchema.nullable(),
	resources: analyticsResourceMetricsOutputSchema.nullable(),
	sections: z.array(sectionSchema),
});

const accountOverviewSchema = z.object({
	user: userSchema,
	notificationCount: z.number(),
	stats: z.array(statSchema),
});

const fleetOverviewSchema = z.object({
	services: z.array(serviceWithStatusSchema),
	stats: z.array(statSchema),
	generatedAt: z.string(),
});

// One ops object per output, so each route gets its own summary and entity name.
const dashboardOps = standard.zod(dashboardOverviewSchema, "bffDashboardOverview");
const projectListOps = standard.zod(projectOverviewListSchema, "bffProjectOverviewList");
const projectDetailOps = standard.zod(projectDetailSchema, "bffProjectDetail");
const serviceDetailOps = standard.zod(serviceDetailSchema, "bffServiceDetail");
const analyticsOps = standard.zod(analyticsOverviewSchema, "bffAnalyticsOverview");
const accountOps = standard.zod(accountOverviewSchema, "bffAccountOverview");
const fleetOps = standard.zod(fleetOverviewSchema, "bffFleetOverview");

/**
 * The operator's landing page, in ONE round trip.
 *
 * Composes the operator (identity), the project list (project), each project's
 * service and deployment roll-up (project + runtime), and live system metrics
 * (identity analytics).
 */
export const bffDashboardOverviewContract = dashboardOps
	.list()
	.path("/dashboard/overview")
	.input((b) => b.query(z.object({}).optional()))
	.output(dashboardOverviewSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * The projects list with each project's roll-up.
 *
 * Pagination applies to PROJECTS, and the roll-up is read for that page only —
 * joining first and paginating after would read every project's services to
 * render one page.
 */
export const bffListProjectOverviewsContract = projectListOps
	.list()
	.path("/projects")
	.input((b) =>
		b.query(
			z
				.object({
					limit: z.coerce.number().int().positive().max(100).default(20),
					offset: z.coerce.number().int().nonnegative().default(0),
					search: z.string().optional(),
				})
				.optional(),
		),
	)
	.output(projectOverviewListSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** One project's detail screen: the project, its services with status, its domains. */
export const bffProjectDetailContract = projectDetailOps
	.read({ idFieldName: "projectId", idSchema: z.uuid() })
	.input((b) => b.params((p) => p`/projects/${p("projectId", z.uuid())}`))
	.output(projectDetailSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** One service's detail screen, with its latest deployment and recent history. */
export const bffServiceDetailContract = serviceDetailOps
	.read({ idFieldName: "serviceId", idSchema: z.uuid() })
	.input((b) => b.params((p) => p`/services/${p("serviceId", z.uuid())}`))
	.output(serviceDetailSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * The analytics page, composed from the metric families it charts together.
 *
 * These are four procedures on ONE service, but the page charts them on ONE time
 * axis — so they are read together, in parallel, with the window applied once.
 */
export const bffAnalyticsOverviewContract = analyticsOps
	.list()
	.path("/analytics/overview")
	.input((b) => b.query(z.object({ timeRange: timeRangeSchema.default("1d") })))
	.output(analyticsOverviewSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** The operator's profile plus what the app shell renders beside it. */
export const bffAccountOverviewContract = accountOps
	.list()
	.path("/account/overview")
	.input((b) => b.query(z.object({}).optional()))
	.output(accountOverviewSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * The device/CLI view: which services exist and how they are doing.
 *
 * Separate from the dashboard because the DEVICE screen wants the flat service
 * list, not the operator's projects — same sources, different composition, and
 * the composition is what this layer owns.
 */
export const bffFleetOverviewContract = fleetOps
	.list()
	.path("/fleet/overview")
	.input((b) => b.query(z.object({}).optional()))
	.output(fleetOverviewSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * The BFF's OWN namespace, mounted beside the delegated service namespaces.
 *
 * `/bff` is deliberate: these are the BFF's COMPOSITION surface, and a distinct
 * prefix keeps them from being mistaken for a service's CRUD route —
 * `GET /bff/projects` is a roll-up, `GET /project` is the resource.
 */
export const bffOrchestrationContract = oc
	.meta(openapi({ tags: ["BFF"], prefix: "/bff" }))
	.router({
		dashboardOverview: bffDashboardOverviewContract,
		listProjectOverviews: bffListProjectOverviewsContract,
		projectDetail: bffProjectDetailContract,
		serviceDetail: bffServiceDetailContract,
		analyticsOverview: bffAnalyticsOverviewContract,
		accountOverview: bffAccountOverviewContract,
		fleetOverview: bffFleetOverviewContract,
	});

export type BffOrchestrationContract = typeof bffOrchestrationContract;

/**
 * The management console — the ONE URL whose visual depends on what is running.
 *
 * ── WHY THIS IS THE BFF'S AND NOT A SERVICE'S ───────────────────────────────
 * The state belongs to fleet (`platform` domain), and the BFF reads it through
 * fleet's typed client like any other source. What makes these procedures the
 * BFF's is the OTHER half: the pages they drive are the API's OWN rendered
 * fallback, served at the same URL as the web app, and the mutations they carry
 * are the controls ON those pages. A service renders no UI, so a service holding
 * this surface would be a service that knows what a screen looks like.
 *
 * ── WHY THE SHAPES ARE THE SERVICE'S, NOT RE-DECLARED ──────────────────────
 * `managedWebStateOutputSchema` IS the console's contract: fleet's reconciler
 * produces it and the BFF's page renders it. Re-declaring a BFF-local copy would
 * mean a field added to the reconciler state silently missing from the page — the
 * drift the composition rule exists to prevent, and one that buys nothing here
 * because the state is not JOINED with anything.
 */
/**
 * The console surface, as its own router.
 *
 * ── WHY THE BUILDER FORM MIRRORS THE SERVICE'S EXACTLY ──────────────────────
 * fleet declares these with `b.body(...)`, which is the DETAILED form: the handler
 * returns `{ status, body }` and the client unwraps it. Declaring a compact
 * `.output(schema)` here instead would make the BFF's own controller receive the
 * SERVICE's `{ status, body }` wrapper as its value — compiling nowhere and, had it
 * been cast, serialising the envelope to the browser. Matching the form is what makes
 * the BFF's procedures genuinely interchangeable with the ones they replace.
 */
export const consoleWebStateContract = consoleStateOps
	.read()
	.path("/console/web-app/state")
	.input(z.object({}))
	.output(managedWebStateOutputSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Flip `managed_web_app.enabled` and converge; the console visual flips with it. */
export const consoleToggleWebContract = consoleActionOps
	.create()
	.path("/console/web-app/toggle")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Force a restart of the managed web container (also enables it). */
export const consoleRestartWebContract = consoleActionOps
	.create()
	.path("/console/web-app/restart")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Set (or clear, with null) the custom public origin the web app answers on. */
export const consoleSetWebOriginContract = consoleOriginOps
	.create()
	.path("/console/web-app/origin")
	.input((b) => b.body(setManagedWebOriginInputSchema))
	.output((b) => b.body(setManagedWebOriginOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Provision the web app's own tunnel (zone must own the hostname). */
export const consoleEnableWebTunnelContract = consoleOriginOps
	.create()
	.path("/console/web-app/tunnel/enable")
	.input((b) => b.body(enableManagedWebTunnelInputSchema))
	.output((b) => b.body(enableManagedWebTunnelOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Remove the web app's own tunnel. */
export const consoleDisableWebTunnelContract = consoleActionOps
	.create()
	.path("/console/web-app/tunnel/disable")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * The console surface, as its own router.
 *
 * Separate from `bffOrchestrationContract` because it is a different KIND of thing:
 * the screens above COMPOSE several services, these expose one and exist because
 * the BFF owns the page that renders it. Keeping them apart means a reader can tell
 * "this joined four sources" from "this is the console's control panel" at a glance.
 */
export const bffConsoleContract = oc
	.meta(openapi({ tags: ["BFF / Console"], prefix: "/bff" }))
	.router({
		webState: consoleWebStateContract,
		toggleWeb: consoleToggleWebContract,
		restartWeb: consoleRestartWebContract,
		setWebOrigin: consoleSetWebOriginContract,
		enableWebTunnel: consoleEnableWebTunnelContract,
		disableWebTunnel: consoleDisableWebTunnelContract,
	});

export type BffConsoleContract = typeof bffConsoleContract;
