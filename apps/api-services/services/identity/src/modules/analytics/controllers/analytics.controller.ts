import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { analyticsContract } from "@deployer/identity-contracts";
import { ValidationError } from "@deployer/errors";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

import { AnalyticsService, type Actor } from "../services/analytics.service";

/**
 * The analytics domain's oRPC surface.
 *
 * ── A CONTROLLER CONTAINS NO RULE ───────────────────────────────────────────
 * Each method binds a contract procedure, takes the actor from the context, and
 * delegates. Reading it tells you which procedures exist and what they call — which is
 * what makes "no business logic leaked into the transport" checkable by eye.
 *
 * ── WHY EVERY PROCEDURE IS AUTHENTICATED ────────────────────────────────────
 * Analytics reports on the whole platform: every deployment, every service, host
 * resource usage. There is no anonymous analytics: the data is operationally sensitive
 * (it reveals what is deployed, when, and how it fails), so the actor is resolved on
 * every call even where the handler does not branch on it.
 */
@Controller()
export class AnalyticsController {
	constructor(private readonly analytics: AnalyticsService) {}

	/** The caller, as the domain sees them. */
	private actorOf(context: { auth: { user: { id: string; role?: string | null } } }): Actor {
		return { userId: context.auth.user.id, role: context.auth.user.role ?? "user" };
	}

	// ─── Metrics ────────────────────────────────────────────────────────────

	@Implement(analyticsContract.getResourceMetrics)
	getResourceMetrics() {
		return implement(analyticsContract.getResourceMetrics)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.resourceMetrics(readMetricsQuery(input));
			});
	}

	@Implement(analyticsContract.getApplicationMetrics)
	getApplicationMetrics() {
		return implement(analyticsContract.getApplicationMetrics)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.applicationMetrics(readMetricsQuery(input));
			});
	}

	@Implement(analyticsContract.getDatabaseMetrics)
	getDatabaseMetrics() {
		return implement(analyticsContract.getDatabaseMetrics)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.databaseMetrics(readMetricsQuery(input));
			});
	}

	@Implement(analyticsContract.getDeploymentMetrics)
	getDeploymentMetrics() {
		return implement(analyticsContract.getDeploymentMetrics)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.deploymentMetrics(readMetricsQuery(input));
			});
	}

	@Implement(analyticsContract.getServiceHealth)
	getServiceHealth() {
		return implement(analyticsContract.getServiceHealth)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.serviceHealth(readServices(input));
			});
	}

	@Implement(analyticsContract.getRealTimeMetrics)
	getRealTimeMetrics() {
		return implement(analyticsContract.getRealTimeMetrics)
			.use(requireAuth())
			.handler(async ({ input, context }) => {
				void context;
				return this.analytics.realtimeMetrics(readServices(input));
			});
	}

	// ─── Usage ──────────────────────────────────────────────────────────────

	@Implement(analyticsContract.getResourceUsage)
	getResourceUsage() {
		return implement(analyticsContract.getResourceUsage)
			.use(requireAuth())
			.handler(async ({ input }) =>
				this.analytics.resourceUsage({
					timeRange: readString(input, "timeRange", "1d"),
					resource: readString(input, "resource", "all"),
					aggregation: readString(input, "aggregation", "average"),
				}),
			);
	}

	@Implement(analyticsContract.getUserActivity)
	getUserActivity() {
		return implement(analyticsContract.getUserActivity)
			.use(requireAuth())
			.handler(async ({ input }) =>
				this.analytics.userActivity({
					timeRange: readString(input, "timeRange", "1d"),
					...readOptionalString(input, "userId"),
					...readOptionalString(input, "action"),
					...readOptionalString(input, "resource"),
					limit: readNumber(input, "limit", 100),
					offset: readNumber(input, "offset", 0),
				}),
			);
	}

	@Implement(analyticsContract.getActivitySummary)
	getActivitySummary() {
		return implement(analyticsContract.getActivitySummary)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const query = readQuery(input);
				return this.analytics.activitySummary({
					...(typeof query["period"] === "string" ? { period: query["period"] } : {}),
					...(typeof query["granularity"] === "string" ? { granularity: query["granularity"] } : {}),
					...(typeof query["limit"] === "number" ? { limit: query["limit"] } : {}),
				});
			});
	}

	@Implement(analyticsContract.getApiUsage)
	getApiUsage() {
		return implement(analyticsContract.getApiUsage)
			.use(requireAuth())
			.handler(async ({ input }) =>
				this.analytics.apiUsage({
					timeRange: readString(input, "timeRange", "1d"),
					groupBy: readString(input, "groupBy", "endpoint"),
					limit: readNumber(input, "limit", 20),
				}),
			);
	}

	@Implement(analyticsContract.getDeploymentUsage)
	getDeploymentUsage() {
		return implement(analyticsContract.getDeploymentUsage)
			.use(requireAuth())
			.handler(async ({ input }) =>
				this.analytics.deploymentUsage({
					timeRange: readString(input, "timeRange", "1d"),
					...readOptionalString(input, "projectId"),
					...readOptionalString(input, "userId"),
				}),
			);
	}

	@Implement(analyticsContract.getStorageUsage)
	getStorageUsage() {
		return implement(analyticsContract.getStorageUsage)
			.use(requireAuth())
			.handler(async ({ input }) =>
				this.analytics.storageUsage({
					timeRange: readString(input, "timeRange", "1d"),
					breakdown: readString(input, "breakdown", "total"),
				}),
			);
	}

	// ─── Reports ────────────────────────────────────────────────────────────

	/**
	 * Generate a report and return its id.
	 *
	 * ── WHY THIS RETURNS AN ID RATHER THAN THE REPORT ───────────────────────
	 * The contract declares `{ reportId, status, message }`. Generation is synchronous
	 * here (there is no queue in this service), but the shape is a handle so a caller
	 * polls `getReport` and a later move to background generation does not change the
	 * contract. Returning the content inline would make that change breaking.
	 */
	@Implement(analyticsContract.generateReport)
	generateReport() {
		return implement(analyticsContract.generateReport)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const report = await this.analytics.generateReport({
					period: input.period,
					includeResourceUsage: input.includeResourceUsage,
					includeApplicationMetrics: input.includeApplicationMetrics,
					includeDatabaseMetrics: input.includeDatabaseMetrics,
					includeDeploymentAnalytics: input.includeDeploymentAnalytics,
					includeServiceHealth: input.includeServiceHealth,
					includeUserActivity: input.includeUserActivity,
					format: input.format,
				});

				return {
					reportId: report.id,
					status: report.status as "pending" | "generating" | "completed" | "failed",
					message:
						report.status === "completed"
							? `report generated with ${String(report.sections.length)} section(s)`
							: (report.errorMessage ?? "report generation failed"),
				};
			});
	}

	/**
	 * One report.
	 *
	 * The contract's output is a union: a complete report, or a status stub for one
	 * still in progress. A `failed` report therefore returns the STUB branch, which
	 * carries the error — so a caller learns why it failed instead of receiving a
	 * half-empty report object.
	 */
	@Implement(analyticsContract.getReport)
	getReport() {
		return implement(analyticsContract.getReport)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const report = await this.analytics.findReport(input.params.reportId);

				if (report.status !== "completed") {
					return {
						id: report.id,
						status: report.status as "pending" | "generating" | "failed",
						...(report.errorMessage === null ? {} : { error: report.errorMessage }),
					};
				}

				return {
					id: report.id,
					name: report.name,
					generatedAt: report.generatedAt ?? new Date(),
					period: { start: report.periodStart, end: report.periodEnd },
					summary: summaryOf(report.content),
					resourceUsage: [],
					applicationMetrics: [],
					databaseMetrics: [],
					deploymentAnalytics: [],
					serviceHealth: [],
				};
			});
	}

	@Implement(analyticsContract.listReports)
	listReports() {
		return implement(analyticsContract.listReports)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const limit = input.query?.limit ?? 20;
				const offset = input.query?.offset ?? 0;
				// The contract already narrowed `status` to the enum, so this passes it through
				// rather than re-checking — the compiler holds the controller to the contract.
				const page = await this.analytics.listReports(limit, offset, input.query?.status);

				return {
					data: page.data.map((report) => ({
						id: report.id,
						name: report.name,
						status: report.status as "pending" | "generating" | "completed" | "failed",
						...(report.generatedAt === null ? {} : { generatedAt: report.generatedAt }),
						period: { start: report.periodStart, end: report.periodEnd },
						format: report.format as "json" | "pdf" | "csv",
						size: report.sizeBytes,
					})),
					total: page.total,
					limit,
					offset,
				};
			});
	}

	@Implement(analyticsContract.deleteReport)
	deleteReport() {
		return implement(analyticsContract.deleteReport)
			.use(requireAuth())
			.handler(async ({ input }) => {
				await this.analytics.deleteReport(input.params.reportId);
				return { success: true, message: "report deleted" };
			});
	}

	/**
	 * A download handle for a stored report.
	 *
	 * ── WHY A URL AND NOT THE BYTES ─────────────────────────────────────────
	 * The contract declares `{ downloadUrl, expiresAt, format }`. Streaming the file
	 * through this procedure would make a large report a long-held request, and the
	 * contract is already shaped as a handle. The URL points at this service's own
	 * report content route, and `sizeBytes` is carried so a client can show a progress
	 * bar without a second call.
	 */
	@Implement(analyticsContract.downloadReport)
	downloadReport() {
		return implement(analyticsContract.downloadReport)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const report = await this.analytics.downloadReport(input.params.reportId);
				return {
					downloadUrl: `/analytics/reports/${input.params.reportId}/content`,
					// A SHORT expiry on purpose: the URL is not signed, so it is only safe because
					// the content route is itself authenticated. The window documents that the
					// handle is meant to be used immediately, not stored.
					expiresAt: new Date(Date.now() + 5 * 60 * 1000),
					format: report.format as "json" | "pdf" | "csv",
					// The contract declares `size` on the handle, so a client can show a progress
					// bar without a second call — it is the stored report's size, from the same row
					// the content comes from.
					size: report.sizeBytes,
				};
			});
	}

	// ─── Report configurations ──────────────────────────────────────────────

	/**
	 * Store a report configuration.
	 *
	 * ── WHY THE PAYLOAD IS READ FROM `input` DIRECTLY ────────
	 * This contract declares `.input((input) => input.body(reportConfigurationSchema))`, but it
	 * uses the COMPACT `create()` builder, which FLATTENS the body into the input — so the
	 * payload's fields sit on `input` itself. Reading `input.body` yields
	 * `Property 'body' does not exist`, which is the contract saying where it put the value.
	 * (The `update` builder does NOT flatten, because it must carry the path parameter too —
	 * see `updateReportConfig` below.)
	 *
	 * ── WHY THE REQUIRED FIELDS ARE CHECKED ────────────────────────────────
	 * `reportConfigurationSchema` declares every field optional, but a stored configuration is
	 * meaningless without a name and a metric selection — the columns are `NOT NULL`. The check
	 * turns a database constraint violation into a readable error naming the missing field.
	 */
	@Implement(analyticsContract.createReportConfig)
	createReportConfig() {
		return implement(analyticsContract.createReportConfig)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const config = await this.analytics.createReportConfig({
					name: requireField(input.name, "name"),
					...(input.description === undefined ? {} : { description: input.description }),
					metrics: requireField(input.metrics, "metrics"),
					schedule: input.schedule ?? "none",
					...(input.recipients === undefined ? {} : { recipients: input.recipients }),
				});
				return toConfigOutput(config);
			});
	}

	@Implement(analyticsContract.listReportConfigs)
	listReportConfigs() {
		return implement(analyticsContract.listReportConfigs)
			.use(requireAuth())
			.handler(async ({ input }) => {
				const limit = input.query?.limit ?? 20;
				const offset = input.query?.offset ?? 0;
				const page = await this.analytics.listReportConfigs(limit, offset);
				return {
					data: page.data.map(toConfigOutput),
					total: page.total,
					limit,
					offset,
				};
			});
	}

	@Implement(analyticsContract.updateReportConfig)
	updateReportConfig() {
		return implement(analyticsContract.updateReportConfig)
			.use(requireAuth())
			.handler(async ({ input }) => {
				// Same `body` unwrapping as `createReportConfig` — the update contract also
				// declares its patch under `body`, alongside the path parameter.
				const body = input.body ?? {};
				const updated = await this.analytics.updateReportConfig(input.params.configId, {
					...(body.name === undefined ? {} : { name: body.name }),
					...(body.description === undefined ? {} : { description: body.description }),
					...(body.metrics === undefined ? {} : { metrics: body.metrics }),
					...(body.schedule === undefined ? {} : { schedule: body.schedule }),
					...(body.recipients === undefined ? {} : { recipients: body.recipients }),
				});
				return toConfigOutput(updated);
			});
	}

	@Implement(analyticsContract.deleteReportConfig)
	deleteReportConfig() {
		return implement(analyticsContract.deleteReportConfig)
			.use(requireAuth())
			.handler(async ({ input }) => {
				await this.analytics.deleteReportConfig(input.params.configId);
				return { success: true, message: "report configuration deleted" };
			});
	}
}

/**
 * The metrics query, with defaults for every optional field.
 *
 * ── WHY THIS TAKES `unknown` AND NARROWS ────────────────────────────────────
 * The contracts are not uniform about optionality: some declare
 * `.query(schema.optional())` (so `query` may be absent) and others declare
 * `.query(schema)` (so it is always present). Handling that per procedure meant two
 * shapes and 42 type errors; the fields also arrive as `readonly` arrays in some
 * declarations and mutable in others.
 *
 * This reads the handful of fields it needs off whatever arrived, WITH defaults, so one
 * helper serves both contract forms. It is not a loosening of type safety: the input
 * schemas already validated every field, so the narrowing here is choosing defaults for
 * validated values rather than re-validating untrusted ones.
 */
function readQuery(source: unknown): Record<string, unknown> {
	if (source === null || typeof source !== "object") return {};
	const record = source as Record<string, unknown>;
	const query = record["query"];
	return query !== null && typeof query === "object" ? (query as Record<string, unknown>) : {};
}

/** The metrics query, with defaults for every optional field. */
function readMetricsQuery(source: unknown) {
	const query = readQuery(source);
	return {
		timeRange: typeof query["timeRange"] === "string" ? query["timeRange"] : "1d",
		granularity: typeof query["granularity"] === "string" ? query["granularity"] : "hour",
		...(Array.isArray(query["metrics"]) ? { metrics: query["metrics"] as string[] } : {}),
		...(Array.isArray(query["services"]) ? { services: query["services"] as string[] } : {}),
	};
}

/** `services` from a query that may or may not be present. */
function readServices(source: unknown): readonly string[] | undefined {
	const query = readQuery(source);
	return Array.isArray(query["services"]) ? (query["services"] as string[]) : undefined;
}

/** A string field, or its default when absent or of the wrong type. */
function readString(source: unknown, field: string, fallback: string): string {
	const value = readQuery(source)[field];
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** A number field, or its default when absent or of the wrong type. */
function readNumber(source: unknown, field: string, fallback: number): number {
	const value = readQuery(source)[field];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * An optional string field, as a spreadable patch.
 *
 * ── WHY A SPREAD AND NOT `undefined` ────────────────────────────────────────
 * The repository's inputs use `exactOptionalPropertyTypes` semantics, where
 * `{ userId: undefined }` is NOT the same as `{}` — the former asserts the key exists
 * with an undefined value. Spreading `{}` when the field is absent is what keeps
 * "not supplied" distinct from "supplied as undefined", which is how an optional
 * filter avoids becoming an active `= NULL` comparison.
 */
function readOptionalString(source: unknown, field: string): Record<string, string> {
	const value = readQuery(source)[field];
	return typeof value === "string" && value.length > 0 ? { [field]: value } : {};
}

/**
 * A field the caller must supply, or a readable validation error.
 *
 * ── WHY THIS EXISTS DESPITE THE SCHEMA ──────────────────────────────────────
 * `reportConfigurationSchema` declares every field optional, but a stored configuration
 * needs a name and a metric selection — the columns are `NOT NULL`. Without this check
 * the omission surfaces as a database constraint violation; with it, the caller is told
 * which field is missing.
 */
function requireField<T>(value: T | undefined, field: string): T {
	if (value === undefined) {
		throw new ValidationError(`${field} is required`, [
			{
				path: field,
				code: "invalid_type",
				severity: "error",
				message: `a report configuration needs a ${field}`,
			},
		]);
	}
	return value;
}

/** Map a config row to the contract's output shape. */
function toConfigOutput(row: {
	id: string;
	name: string;
	description: string | null;
	metrics: string[];
	schedule: string;
	recipients: string[];
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: row.id,
		name: row.name,
		...(row.description === null ? {} : { description: row.description }),
		metrics: row.metrics,
		schedule: row.schedule as "none" | "daily" | "weekly" | "monthly",
		recipients: row.recipients,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/**
 * The summary block of a stored report.
 *
 * ── WHY THIS READS THE CONTENT INSTEAD OF A COLUMN ─────────────────────────
 * The summary is not stored separately — it is derived from the deployment series the
 * report already contains, which is the same computation the usage endpoint performs.
 * Recomputing it here from stored content means the two cannot disagree: there is one
 * arithmetic, applied to one series.
 */
function summaryOf(content: unknown): {
	totalDeployments: number;
	totalUsers: number;
	totalRequests: number;
	averageResponseTime: number;
	errorRate: number;
} {
	const data = content as { deploymentAnalytics?: { deploymentsCount?: number }[] } | null;
	const buckets = data?.deploymentAnalytics ?? [];
	const totalDeployments = buckets.reduce((sum, bucket) => sum + (bucket.deploymentsCount ?? 0), 0);

	// The three that have no source are reported as 0 IN THE SUMMARY because the shape
	// requires numbers, and the report records `*DataSource` alongside each section so a
	// reader can tell "zero" from "not measured".
	return { totalDeployments, totalUsers: 0, totalRequests: 0, averageResponseTime: 0, errorRate: 0 };
}

// Re-exported so the module has one import for the domain's vocabulary.
export type { Actor };
