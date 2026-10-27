import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";

import { allOf, correlated, relationPredicates } from "./relation-predicates";

/**
 * A miniature three-level schema, so the predicates are exercised against real Drizzle
 * columns and real emitted SQL.
 *
 * ── WHY REAL TABLES AND NOT MOCKS ───────────────────────────────────────────
 * The entire value of these helpers is the SQL they produce. A mocked column would let
 * every assertion pass while the emitted statement was invalid — which is the only way
 * this module can actually be broken. `drizzle.mock()` gives a handle that renders real
 * SQL with no connection, so each test asserts the statement Postgres would receive.
 *
 * `deployments` deliberately hangs off `services` rather than off `projects`, mirroring
 * the real schema: a deployment belongs to a SERVICE, so "this project's deployments" is
 * a two-hop question. That shape is the reason a nested EXISTS is the right tool.
 */
const projects = pgTable("projects", {
	id: text("id").primaryKey(),
	ownerId: text("owner_id").notNull(),
});

const services = pgTable("services", {
	id: text("id").primaryKey(),
	projectId: text("project_id").notNull(),
});

const deployments = pgTable("deployments", {
	id: text("id").primaryKey(),
	serviceId: text("service_id").notNull(),
	status: text("status").notNull(),
});

const db = drizzle.mock();
const rel = relationPredicates(db);

/** The SQL of a `select` over `projects` filtered by `condition`. */
function sqlFor(condition: unknown): string {
	return db
		.select()
		.from(projects)
		.where(condition as never)
		.toSQL().sql;
}

describe("relationPredicates", () => {
	describe("existsIn", () => {
		it("emits a CORRELATED EXISTS over the inner table", () => {
			const sql = sqlFor(rel.existsIn(services, eq(services.projectId, projects.id)));

			// Both sides of the correlation must be present. Without `services.project_id =
			// projects.id` the subquery would be true for ANY service, and the filter would
			// silently narrow nothing.
			expect(sql).toContain('"services"."project_id" = "projects"."id"');
		});

		it("parenthesises the subquery, which Postgres requires", () => {
			// Drizzle's `exists()` is `sql\`exists ${subquery}\`` — it adds no parentheses
			// itself and depends on the interpolated value being a SUBQUERY. Passing a raw
			// `sql\`select 1 …\`` fragment instead yields `exists select 1 …`, which Postgres
			// rejects. This assertion is what pins the subquery (rather than the fragment)
			// being what gets interpolated.
			const sql = sqlFor(rel.existsIn(services, eq(services.projectId, projects.id)));

			expect(sql).toMatch(/exists\s*\(/i);
		});

		it("carries the extra conditions alongside the correlation", () => {
			const sql = sqlFor(
				rel.existsIn(
					deployments,
					eq(deployments.serviceId, services.id),
					eq(deployments.status, "running"),
				),
			);

			expect(sql).toContain('"deployments"."service_id" = "services"."id"');
			expect(sql).toContain('"deployments"."status"');
			// The value is bound as a parameter, never interpolated into the text.
			expect(sql).not.toContain("running");
		});

		it("binds condition values as parameters rather than inlining them", () => {
			const { sql, params } = db
				.select()
				.from(projects)
				.where(
					rel.existsIn(
						deployments,
						eq(deployments.serviceId, services.id),
						eq(deployments.status, "running"),
					),
				)
				.toSQL();

			expect(params).toContain("running");
			expect(sql).not.toContain("running");
		});

		it("nests, so a two-hop question is ONE condition", () => {
			const sql = sqlFor(
				rel.existsIn(
					services,
					eq(services.projectId, projects.id),
					rel.existsIn(
						deployments,
						eq(deployments.serviceId, services.id),
						eq(deployments.status, "running"),
					),
				),
			);

			// Both hops in a single EXISTS chain — the alternative to a double join, which
			// would return the project once per deployment and break `limit`/`count`.
			expect(sql).toContain('"services"."project_id" = "projects"."id"');
			expect(sql).toContain('"deployments"."service_id" = "services"."id"');
			// Two EXISTS, not one: the hops are genuinely nested.
			expect(sql.match(/exists/gi)?.length).toBe(2);
		});

		it("throws rather than emit an uncorrelated EXISTS", () => {
			// The failure this guards against is SILENT: an uncorrelated EXISTS is true
			// whenever the inner table is non-empty, so the filter would match everything
			// while looking like it narrowed the result.
			expect(() => rel.existsIn(services, undefined)).toThrow(/uncorrelated EXISTS/i);
		});

		it("drops undefined conditions instead of sending them to the driver", () => {
			const status: string | undefined = undefined;
			const { params } = db
				.select()
				.from(projects)
				.where(
					rel.existsIn(
						deployments,
						eq(deployments.serviceId, services.id),
						status === undefined ? undefined : eq(deployments.status, status),
					),
				)
				.toSQL();

			// No `undefined` reaches the wire; the condition is simply absent. A real driver
			// would otherwise receive an unbound parameter.
			expect(params).not.toContain(undefined);
		});
	});

	describe("notExistsIn", () => {
		it("emits NOT EXISTS, for the 'has nothing' filter", () => {
			const sql = sqlFor(rel.notExistsIn(deployments, eq(deployments.serviceId, services.id)));

			expect(sql).toMatch(/not exists\s*\(/i);
		});

		it("guards the uncorrelated case the same way", () => {
			expect(() => rel.notExistsIn(services, undefined)).toThrow(/uncorrelated EXISTS/i);
		});
	});

	describe("relatedIs", () => {
		it("is the single-condition shorthand and still correlates", () => {
			const { sql, params } = db
				.select()
				.from(projects)
				.where(
					rel.relatedIs(
						deployments,
						eq(deployments.serviceId, services.id),
						deployments.status,
						"running",
					),
				)
				.toSQL();

			expect(sql).toMatch(/exists\s*\(/i);
			expect(sql).toContain('"deployments"."service_id" = "services"."id"');
			expect(params).toContain("running");
		});

		it("guards the uncorrelated case too", () => {
			expect(() => rel.relatedIs(services, undefined, services.projectId, "x")).toThrow(
				/uncorrelated EXISTS/i,
			);
		});
	});

	describe("correlated (the pure predicate)", () => {
		it("throws when there is neither correlation nor condition", () => {
			expect(() => correlated(services, undefined)).toThrow(/uncorrelated EXISTS/i);
			expect(() => correlated(services, undefined, undefined)).toThrow(/uncorrelated EXISTS/i);
		});

		it("returns the correlation predicate when only a correlation is given", () => {
			const predicate = correlated(services, eq(services.projectId, projects.id));
			expect(predicate).toBeDefined();
		});
	});

	describe("allOf", () => {
		it("returns undefined for nothing, so no WHERE clause is emitted", () => {
			// `and()` of nothing renders `WHERE 1 = 1`: harmless to Postgres, misleading to a
			// reader, and it costs the planner its row estimate.
			expect(allOf()).toBeUndefined();
			expect(allOf(undefined, undefined)).toBeUndefined();
		});

		it("ignores undefined members and keeps the real ones", () => {
			const owner: string | undefined = undefined;
			const combined = allOf(
				owner === undefined ? undefined : eq(projects.ownerId, owner),
				eq(projects.id, "p1"),
			);

			const { sql, params } = db.select().from(projects).where(combined).toSQL();
			expect(params).toContain("p1");
			expect(params).not.toContain(undefined);
			expect(sql).toContain('"projects"."id"');
		});

		it("combines a column condition with a relation condition", () => {
			const combined = allOf(
				eq(projects.ownerId, "u1"),
				rel.existsIn(services, eq(services.projectId, projects.id)),
			);

			const { sql, params } = db.select().from(projects).where(combined).toSQL();

			expect(sql).toContain('"projects"."owner_id"');
			expect(sql).toMatch(/exists\s*\(/i);
			expect(sql).toContain('"services"."project_id" = "projects"."id"');
			expect(params).toContain("u1");
		});
	});
});
