import { and, eq, exists, getTableName, notExists, type SQL, type SQLWrapper } from "drizzle-orm";
import type { AnyColumn, Table } from "drizzle-orm";

/**
 * Any Drizzle table.
 *
 * ── WHY THIS ALIAS EXISTS INSTEAD OF USING `Table` DIRECTLY ─────────────────
 * Drizzle's `Table` is generic in its config
 * (`Table<TUpdateTableConfig<TableConfig, TPartial>>`), so writing `Table` bare is a
 * type error requiring an argument. `AnyTable` names the unparameterised form once,
 * so the signatures below read as "any table" rather than repeating a type argument
 * nobody cares about at the call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = Table<any>;

/**
 * Predicates over RELATED tables — the "…where its deployments are running" half of a
 * query.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 * A plain Drizzle `where` can only talk about the table being selected. The moment a
 * caller needs "projects that have a running deployment", the honest answers are a JOIN
 * — which duplicates the parent row per child, so `limit` and `count` stop meaning what
 * they say — or a subquery, which every caller then hand-writes slightly differently,
 * each with its own chance of getting the correlation clause wrong.
 *
 * These helpers are that subquery, written once:
 *
 * ```ts
 * const rel = relationPredicates(db);
 *
 * // projects owned by the actor that have a service with a running deployment
 * db.select().from(projects).where(allOf(
 *   eq(projects.ownerId, actor.userId),
 *   rel.existsIn(
 *     services, eq(services.projectId, projects.id),
 *     rel.existsIn(deployments, eq(deployments.serviceId, services.id), eq(deployments.status, "running")),
 *   ),
 * ));
 * ```
 *
 * The nesting composes: a nested `existsIn` is an `SQL`, so it is a valid condition for
 * the outer one. That turns a two-hop question into a single expression instead of a
 * hand-rolled double join.
 *
 * ── WHY EXISTS AND NOT A JOIN ───────────────────────────────────────────────
 * `EXISTS` answers a yes/no question about the parent row, so it never multiplies rows.
 * That keeps `limit`, `offset` and `count(*)` correct — which a JOIN silently breaks,
 * because a project with three running deployments appears three times and a page of 20
 * shows fewer than 20 projects.
 *
 * ── WHY `db` IS REQUIRED, AND WHY THE PREDICATE IS EXPORTED SEPARATELY ──────
 * Drizzle's `exists()` is `sql\`exists ${subquery}\`` — it adds NO parentheses, and it
 * relies on the interpolated value being a SUBQUERY for the emitted SQL to be valid.
 * Handing it a raw `sql\`select 1 …\`` fragment produces `exists select 1 …`, which
 * Postgres rejects as a syntax error. Only a builder (`db.select().from(…).where(…)`) is
 * parenthesised, so building the subquery needs the handle.
 *
 * `correlated()` returns just the WHERE predicate for that subquery. It is pure — no
 * database handle — so the correlation logic can be asserted directly, and the db-bound
 * helpers above are thin wrappers that add the subquery Drizzle needs.
 */

/** The slice of a Drizzle instance this module needs — nothing more. */
export type RelationQueryable = {
	select(): {
		from(table: AnyTable): {
			where(condition: SQL | undefined): SQLWrapper;
		};
	};
};

export type RelationPredicates = {
	/** At least one row of `inner` satisfies `correlate` and the extra conditions. */
	existsIn(inner: AnyTable, correlate: SQL | undefined, ...conditions: (SQL | undefined)[]): SQL;
	/** No row of `inner` satisfies `correlate` and the extra conditions. */
	notExistsIn(inner: AnyTable, correlate: SQL | undefined, ...conditions: (SQL | undefined)[]): SQL;
	/** A related row's column equals a value — the common single-condition case. */
	relatedIs(inner: AnyTable, correlate: SQL | undefined, column: AnyColumn, value: unknown): SQL;
};

export function relationPredicates(db: RelationQueryable): RelationPredicates {
	return {
		/**
		 * `correlate` is REQUIRED. An uncorrelated `EXISTS` is true whenever the inner
		 * table has any matching row at all, so the filter silently degrades to "…and that
		 * table is non-empty" — a predicate that looks like it works and quietly returns
		 * everything. A required parameter is the only thing that stops a caller omitting
		 * the half that gives it meaning.
		 */
		existsIn(inner, correlate, ...conditions) {
			return exists(subqueryFor(db, inner, correlate, conditions));
		},

		/**
		 * The "clean" filter — projects with nothing deployed, services with no dependents
		 * — which is what people reach for `LEFT JOIN … WHERE IS NULL` to write.
		 * `NOT EXISTS` says it directly and cannot be broken by a second matching row.
		 */
		notExistsIn(inner, correlate, ...conditions) {
			return notExists(subqueryFor(db, inner, correlate, conditions));
		},

		/**
		 * Exists because this is the overwhelmingly common shape, and the two-argument form
		 * is where the correlation clause gets dropped. Naming the table once here removes
		 * that opportunity.
		 */
		relatedIs(inner, correlate, column, value) {
			return exists(subqueryFor(db, inner, correlate, [eq(column, value)]));
		},
	};
}

/**
 * The correlated predicate for a subquery over `inner` — pure, no database handle.
 *
 * Exported so the correlation logic can be asserted without a connection, and so a
 * caller who already has a subquery in hand can reuse the predicate inside it.
 *
 * ── WHY `correlate` IS CHECKED ON ITS OWN, NOT AS "correlate OR conditions" ───
 * The first version of this guard only rejected the case where there was NEITHER a
 * correlation NOR a condition, on the reasoning that some condition must make the
 * subquery meaningful. That was wrong, and a test caught it: `relatedIs(services,
 * undefined, services.projectId, "x")` supplies a condition, so the guard passed — and
 * the helper then emitted `EXISTS (SELECT … WHERE project_id = 'x')`, an UNCORRELATED
 * subquery that is true for every project as soon as any service matches. Exactly the
 * silent "matches everything" failure the guard exists to prevent.
 *
 * A condition narrows which INNER rows count; only the correlation ties the subquery to
 * the OUTER row. Without the correlation the predicate says nothing about the row being
 * filtered, so its absence is fatal regardless of how many conditions were supplied.
 */
export function correlated(
	inner: AnyTable,
	correlate: SQL | undefined,
	...conditions: (SQL | undefined)[]
): SQL {
	if (correlate === undefined) {
		// Correlate the subquery to the outer row, or fail loudly. Returning a filter that
		// silently matches everything is the one outcome that must not happen, because it
		// looks like it worked.
		throw new Error(
			`relation predicate over "${tableName(inner)}" given no correlation: an UNCORRELATED ` +
				`EXISTS is true whenever any matching inner row exists, so the predicate would match ` +
				`every outer row. Pass the join condition, e.g. eq(services.projectId, projects.id).`,
		);
	}

	// `allOf` is called with a non-undefined `correlate`, so it cannot return undefined —
	// but the compiler only knows `and(...)`'s declared type, not that reasoning. The
	// narrowed local `predicate` proves it: if this were reachable, the guard above would
	// have returned.
	const predicate = allOf(correlate, ...conditions);
	if (predicate === undefined) {
		throw new Error(`relation predicate over "${tableName(inner)}" produced no condition`);
	}
	return predicate;
}

/**
 * A table's SQL name, via Drizzle rather than `String(table)`.
 *
 * `String()` on a table prints `[object Object]`, which would make the errors above
 * useless — and a locally-read symbol slot would be reaching into Drizzle's internals.
 * `getTableName` is the supported accessor.
 */
function tableName(table: AnyTable): string {
	// `getTableName` is typed loosely (it returns `any`), so the result is narrowed
	// here rather than at every call site.
	const name: unknown = getTableName(table);
	return typeof name === "string" ? name : "<unknown table>";
}

/**
 * Compose several predicates into one condition.
 *
 * Returns `undefined` for an empty list rather than `and()` of nothing. `and()` with no
 * conditions renders `WHERE 1 = 1` — harmless to Postgres, misleading to a reader, and it
 * costs the planner its row estimate. `undefined` means the statement genuinely has no
 * WHERE clause, so a caller building conditions from user input does not have to
 * special-case the empty case.
 */
export function allOf(...conditions: (SQL | undefined)[]): SQL | undefined {
	const present = presentConditions(conditions);
	return present.length === 0 ? undefined : and(...present);
}

/** Build the subquery `exists()`/`notExists()` expects, using the caller's handle. */
function subqueryFor(
	db: RelationQueryable,
	inner: AnyTable,
	correlate: SQL | undefined,
	conditions: (SQL | undefined)[],
): SQLWrapper {
	return db.select().from(inner).where(correlated(inner, correlate, ...conditions));
}

/** Drop the `undefined` entries a caller produced conditionally. */
function presentConditions(conditions: (SQL | undefined)[]): SQL[] {
	return conditions.filter((condition): condition is SQL => condition !== undefined);
}
