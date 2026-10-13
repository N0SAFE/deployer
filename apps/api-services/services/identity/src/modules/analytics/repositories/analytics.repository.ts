import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { analyticsReports } from "@deployer/nest-schema/global/identity/analytics";
import { analyticsReportConfigs } from "@deployer/nest-schema/global/identity/analytics";
import { deploymentRollbacks, deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { projects, services } from "@deployer/nest-schema/global/project/deployment";

/**
 * One deployment, reduced to what metrics need.
 *
 * Deliberately not the whole row: analytics reads deployments to COUNT and TIME them,
 * and carrying fields it never uses would mean a schema change here for a column no
 * metric displays.
 */
export interface DeploymentRow {
	readonly id: string;
	readonly serviceId: string;
	readonly status: string;
	readonly createdAt: Date;
	readonly deployCompletedAt: Date | null;
	readonly errorMessage: string | null;
}

/** One rollback, timed by when it started. */
export interface RollbackRow {
	readonly deploymentId: string;
	readonly status: string;
	readonly createdAt: Date;
}

/** The identity of a service, for joining metric rows back to a name. */
export interface ServiceRow {
	readonly id: string;
	readonly name: string;
	readonly projectId: string;
}

/** The report statuses and formats the columns accept. */
export type ReportStatus = "pending" | "generating" | "completed" | "failed";
export type ReportFormat = "json" | "pdf" | "csv";
export type ReportSchedule = "none" | "daily" | "weekly" | "monthly";

/** A persisted report, as the contract declares it. */
export interface ReportRow {
	readonly id: string;
	readonly name: string;
	readonly status: string;
	readonly generatedAt: Date | null;
	readonly periodStart: Date;
	readonly periodEnd: Date;
	readonly format: string;
	readonly sizeBytes: number;
	readonly content: unknown;
	readonly sections: string[];
	readonly errorMessage: string | null;
}

/** A stored report definition. */
export interface ReportConfigRow {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	readonly metrics: string[];
	readonly schedule: string;
	readonly recipients: string[];
	readonly createdAt: Date;
	readonly updatedAt: Date;
}

/**
 * Analytics data access — real sources only.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT QUERY ───────────────────────────────────
 * Three of the metrics this service exposes (application request counts, database
 * query statistics, API usage) have NO connected telemetry source. There is no table
 * to read them from, and this repository does not invent one — the service returns an
 * honest empty payload with `dataSource: "unavailable"` instead, because a chart of
 * fabricated numbers is a lie somebody will act on.
 *
 * ── WHY IT READS TABLES OTHER SERVICES ALSO OWN ─────────────────────────────
 * `deployments` belongs to runtime, `services`/`projects` to project. Analytics only
 * READS them, which is exactly what the ownership registry in `@deployer/nest-schema`
 * records: one writer, and readers who must not mutate. Reporting is inherently a
 * read-across concern, so the alternative — asking runtime for every deployment one
 * HTTP call at a time — would turn one dashboard into hundreds of round trips.
 */
@Injectable()
export class AnalyticsRepository {
	constructor(private readonly database: GlobalDatabaseService) {}

	/** Deployments created inside the window, optionally scoped to services. */
	async deploymentsInRange(start: Date, end: Date, serviceIds?: string[]): Promise<DeploymentRow[]> {
		const conditions: SQL[] = [gte(deployments.createdAt, start), lte(deployments.createdAt, end)];
		if (serviceIds !== undefined && serviceIds.length > 0) {
			// `inArray` only when the caller actually scoped: an empty array would render
			// `IN ()`, which matches nothing and would silently report zero activity for a
			// request that meant "all services".
			conditions.push(inArray(deployments.serviceId, serviceIds));
		}

		const rows = await this.database.db
			.select({
				id: deployments.id,
				serviceId: deployments.serviceId,
				status: deployments.status,
				createdAt: deployments.createdAt,
				deployCompletedAt: deployments.deployCompletedAt,
				errorMessage: deployments.errorMessage,
			})
			.from(deployments)
			.where(and(...conditions))
			.orderBy(asc(deployments.createdAt));

		return rows.map(toDeployment);
	}

	/**
	 * Rollbacks recorded inside the window.
	 *
	 * Timed by `startedAt` with a fallback to `completedAt`: the column is nullable
	 * because a rollback is written when it begins and completed later, so a row read
	 * mid-flight has no completion time. Falling back keeps an in-progress rollback in
	 * the count rather than dropping it from the bucket it belongs to.
	 */
	async rollbacksInRange(start: Date, end: Date): Promise<RollbackRow[]> {
		const rows = await this.database.db
			.select({
				deploymentId: deploymentRollbacks.fromDeploymentId,
				status: deploymentRollbacks.status,
				startedAt: deploymentRollbacks.startedAt,
				completedAt: deploymentRollbacks.completedAt,
			})
			.from(deploymentRollbacks)
			.where(and(gte(deploymentRollbacks.startedAt, start), lte(deploymentRollbacks.startedAt, end)));

		return rows.map((row) => ({
			deploymentId: row.deploymentId,
			status: String(row.status),
			createdAt: toDate(row.startedAt ?? row.completedAt ?? new Date(0)),
		}));
	}

	/** Service identities, optionally narrowed to a set of names. */
	async serviceRows(serviceNames?: string[]): Promise<ServiceRow[]> {
		const where =
			serviceNames !== undefined && serviceNames.length > 0 ? inArray(services.name, serviceNames) : undefined;
		const rows = await this.database.db
			.select({ id: services.id, name: services.name, projectId: services.projectId })
			.from(services)
			.where(where);
		return rows.map((row) => ({ id: row.id, name: row.name, projectId: row.projectId }));
	}

	/**
	 * The most recent deployment per service.
	 *
	 * ── WHY ONE QUERY AND NOT ONE PER SERVICE ───────────────────────────────
	 * A dashboard shows every service, so a per-service lookup is a classic N+1: 200
	 * services becomes 200 round trips for one screen. This reads once and reduces in
	 * memory, so the cost is bounded by the number of deployments rather than by a round
	 * trip per service.
	 *
	 * No time window on purpose: the question is "what is this service's LATEST
	 * deployment", which has no natural window. Narrowing it would report `unknown` for
	 * any service that has not deployed recently — exactly the service an operator is
	 * looking for.
	 */
	async latestDeploymentPerService(serviceIds: string[]): Promise<Map<string, DeploymentRow>> {
		if (serviceIds.length === 0) return new Map();

		const rows = await this.database.db
			.select({
				id: deployments.id,
				serviceId: deployments.serviceId,
				status: deployments.status,
				createdAt: deployments.createdAt,
				deployCompletedAt: deployments.deployCompletedAt,
				errorMessage: deployments.errorMessage,
			})
			.from(deployments)
			.where(inArray(deployments.serviceId, serviceIds))
			.orderBy(desc(deployments.createdAt));

		// Ordered newest-first, so the first row for a service is its latest. The explicit
		// comparison is kept anyway: it costs nothing and means a change to the ordering
		// cannot silently turn "latest" into "first seen".
		const latest = new Map<string, DeploymentRow>();
		for (const row of rows) {
			const candidate = toDeployment(row);
			const existing = latest.get(candidate.serviceId);
			if (existing === undefined || candidate.createdAt.getTime() > existing.createdAt.getTime()) {
				latest.set(candidate.serviceId, candidate);
			}
		}
		return latest;
	}

	/** Project names for a set of ids, so a summary can show them. */
	async projectNamesByIds(ids: string[]): Promise<Map<string, string>> {
		if (ids.length === 0) return new Map();
		const rows = await this.database.db
			.select({ id: projects.id, name: projects.name })
			.from(projects)
			.where(inArray(projects.id, ids));
		return new Map(rows.map((row) => [row.id, row.name]));
	}

	/**
	 * How many services each project has.
	 *
	 * Counted per project in ONE grouped query rather than by loading every service and
	 * grouping in memory: the answer is a number per project, and a project with
	 * thousands of services must not pull thousands of rows to display a count.
	 */
	async serviceCountsByProjects(projectIds: string[]): Promise<Map<string, number>> {
		if (projectIds.length === 0) return new Map();
		const rows = await this.database.db
			.select({ projectId: services.projectId, value: count() })
			.from(services)
			.where(inArray(services.projectId, projectIds))
			.groupBy(services.projectId);
		return new Map(rows.map((row) => [row.projectId, row.value]));
	}

	// ─── Reports ────────────────────────────────────────────────────────────

	/**
	 * Persist a generated report.
	 *
	 * ── WHY `id` IS NOT SUPPLIED ────────────────────────────────────────────
	 * The column is `uuid().primaryKey().defaultRandom()`, so the DATABASE owns the id.
	 * Generating one here would be a second source of truth for identity, and it would
	 * disagree with the column's default rather than replace it.
	 */
	async insertReport(input: {
		name: string;
		// ── WHY THESE ARE LITERAL UNIONS AND NOT `string` ───────────────────────────
		// `format` and `status` are Postgres ENUM columns. A `string` does not satisfy the
		// insert's type (the driver wants one of the enum's members), and the failure is an
		// overload mismatch that says `'name' does not exist` — pointing at the wrong
		// property entirely. Declaring the unions here makes the constraint readable and the
		// error land on the actual problem.
		format: ReportFormat;
		periodStart: Date;
		periodEnd: Date;
		sections: string[];
		content: unknown;
		sizeBytes: number;
		status: ReportStatus;
		errorMessage?: string | null;
	}): Promise<ReportRow> {
		const rows = await this.database.db
			.insert(analyticsReports)
			.values({
				name: input.name,
				format: input.format,
				periodStart: input.periodStart,
				periodEnd: input.periodEnd,
				sections: input.sections,
				content: input.content,
				sizeBytes: input.sizeBytes,
				status: input.status,
				errorMessage: input.errorMessage ?? null,
				// Set only when the report is actually complete: the column is nullable
				// because a pending/failed row has no generation time, and stamping one would
				// make a failed report look finished to anything ordering by it.
				generatedAt: input.status === "completed" ? new Date() : null,
			})
			.returning();

		const row = rows[0];
		if (row === undefined) {
			// `returning()` on a successful insert always yields a row; its absence is a
			// driver-contract violation, not a user error.
			throw new Error("insert into analytics_reports returned no row");
		}
		return toReport(row);
	}

	async findReport(id: string): Promise<ReportRow | null> {
		const rows = await this.database.db
			.select()
			.from(analyticsReports)
			.where(eq(analyticsReports.id, id))
			.limit(1);
		const row = rows[0];
		return row === undefined ? null : toReport(row);
	}

	/**
	 * A page of reports, optionally filtered by status.
	 *
	 * ── WHY `status` IS THE ENUM UNION AND NOT `string` ─────────────────────────
	 * `analytics_reports.status` is a Postgres ENUM column. `eq(column, "some string")`
	 * does not type-check against it, and the failure names the COLUMN with an
	 * unhelpful `not assignable to parameter of type 'never'` — nothing about the actual
	 * problem, which is that the value is not a member of the enum. Declaring the union
	 * makes the constraint visible at the signature.
	 */
	async listReports(
		limit: number,
		offset: number,
		status?: ReportStatus,
	): Promise<{ data: ReportRow[]; total: number }> {
		const where = status === undefined ? undefined : eq(analyticsReports.status, status);
		const [rows, totals] = await Promise.all([
			this.database.db
				.select()
				.from(analyticsReports)
				.where(where)
				.orderBy(desc(analyticsReports.createdAt))
				.limit(limit)
				.offset(offset),
			this.database.db.select({ value: count() }).from(analyticsReports).where(where),
		]);
		return { data: rows.map(toReport), total: totals[0]?.value ?? 0 };
	}

	/** Delete a report, reporting whether anything was removed. */
	async deleteReport(id: string): Promise<boolean> {
		const rows = await this.database.db
			.delete(analyticsReports)
			.where(eq(analyticsReports.id, id))
			.returning({ id: analyticsReports.id });
		return rows.length > 0;
	}

	async insertReportConfig(input: {
		name: string;
		description?: string | null;
		metrics: string[];
		schedule: ReportSchedule;
		recipients: string[];
	}): Promise<ReportConfigRow> {
		const rows = await this.database.db
			.insert(analyticsReportConfigs)
			.values({
				name: input.name,
				description: input.description ?? null,
				metrics: input.metrics,
				schedule: input.schedule,
				recipients: input.recipients,
			})
			.returning();

		const row = rows[0];
		if (row === undefined) throw new Error("insert into analytics_report_configs returned no row");
		return toReportConfig(row);
	}

	async listReportConfigs(limit: number, offset: number): Promise<{ data: ReportConfigRow[]; total: number }> {
		const [rows, totals] = await Promise.all([
			this.database.db
				.select()
				.from(analyticsReportConfigs)
				.orderBy(desc(analyticsReportConfigs.createdAt))
				.limit(limit)
				.offset(offset),
			this.database.db.select({ value: count() }).from(analyticsReportConfigs),
		]);
		return { data: rows.map(toReportConfig), total: totals[0]?.value ?? 0 };
	}

	/**
	 * Update a stored config.
	 *
	 * Every field is optional and only the supplied ones are written, so a caller
	 * changing the schedule cannot blank the metrics by omitting them — the usual
	 * read-modify-write hazard with a PUT-shaped endpoint.
	 */
	async updateReportConfig(
		id: string,
		updates: {
			name?: string;
			description?: string | null;
			metrics?: string[];
			schedule?: ReportSchedule;
			recipients?: string[];
		},
	): Promise<ReportConfigRow | null> {
		const rows = await this.database.db
			.update(analyticsReportConfigs)
			.set({
				...(updates.name === undefined ? {} : { name: updates.name }),
				...(updates.description === undefined ? {} : { description: updates.description }),
				...(updates.metrics === undefined ? {} : { metrics: updates.metrics }),
				...(updates.schedule === undefined ? {} : { schedule: updates.schedule }),
				...(updates.recipients === undefined ? {} : { recipients: updates.recipients }),
				updatedAt: new Date(),
			})
			.where(eq(analyticsReportConfigs.id, id))
			.returning();
		const row = rows[0];
		return row === undefined ? null : toReportConfig(row);
	}

	async deleteReportConfig(id: string): Promise<boolean> {
		const rows = await this.database.db
			.delete(analyticsReportConfigs)
			.where(eq(analyticsReportConfigs.id, id))
			.returning({ id: analyticsReportConfigs.id });
		return rows.length > 0;
	}
}

/**
 * Coerce a value the driver may hand back as either a `Date` or an ISO string.
 *
 * ── WHY THIS IS AT THE READ BOUNDARY AND NOT SCATTERED ──────────────────────
 * The column type says `timestamp`, but what arrives depends on the driver and the
 * codec configuration — a `Date` with one, a string with another. Every duration and
 * bucket calculation calls `.getTime()`, so a string here becomes
 * `getTime is not a function` deep inside a metric, far from the cause. Coercing once,
 * here, means the rest of the module can assume a real `Date`.
 */
function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

/** Map a deployment row to the domain shape, coercing the timestamps. */
function toDeployment(row: {
	id: string;
	serviceId: string;
	status: string;
	createdAt: Date | string;
	deployCompletedAt: Date | string | null;
	errorMessage: string | null;
}): DeploymentRow {
	return {
		id: row.id,
		serviceId: row.serviceId,
		status: String(row.status),
		createdAt: toDate(row.createdAt),
		deployCompletedAt: row.deployCompletedAt == null ? null : toDate(row.deployCompletedAt),
		errorMessage: row.errorMessage,
	};
}

/** Map a report row to the domain shape, normalising the timestamps. */
function toReport(row: typeof analyticsReports.$inferSelect): ReportRow {
	return {
		id: row.id,
		name: row.name,
		status: row.status,
		generatedAt: row.generatedAt == null ? null : toDate(row.generatedAt),
		periodStart: toDate(row.periodStart),
		periodEnd: toDate(row.periodEnd),
		format: row.format,
		sizeBytes: row.sizeBytes ?? 0,
		content: row.content,
		sections: row.sections ?? [],
		errorMessage: row.errorMessage,
	};
}

function toReportConfig(row: typeof analyticsReportConfigs.$inferSelect): ReportConfigRow {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		metrics: row.metrics,
		schedule: row.schedule,
		recipients: row.recipients ?? [],
		createdAt: toDate(row.createdAt),
		updatedAt: toDate(row.updatedAt),
	};
}
