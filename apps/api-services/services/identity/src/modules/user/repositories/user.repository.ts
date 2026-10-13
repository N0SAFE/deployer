import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gt, gte, ilike, lt, lte, type AnyColumn, type SQL } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { user } from "@deployer/nest-schema/global/identity/auth";

import { userRules, type NewUser, type User, type UserPatch } from "../domain/user.entity";

/** A page of users plus the total, so a client can render pagination. */
export interface UserPage {
	readonly data: User[];
	readonly total: number;
}

/**
 * One filter condition as the generated query builder emits it.
 *
 * The list contract's filtering config produces an operator MAP (`{ email: { operator, value } }`)
 * rather than a flat set of values, because one field can carry several operators
 * at once. Translating that syntax into SQL belongs HERE, where the columns are
 * known — the service deals in plain values.
 */
export interface OperatorFilter {
	readonly operator: string;
	readonly value: unknown;
}

/** The filters `list` and `count` accept, as the contract's list config declares them. */
export interface UserListFilter {
	readonly limit: number;
	readonly offset: number;
	readonly sortField: UserSortField;
	readonly sortDirection: "asc" | "desc";
	readonly id?: OperatorFilter;
	readonly email?: OperatorFilter;
	readonly name?: OperatorFilter;
	readonly emailVerified?: unknown;
	readonly createdAt?: OperatorFilter;
}

export type UserSortField = "createdAt" | "name" | "email" | "updatedAt";

/** The parts of a filter that decide WHICH rows, as opposed to how they are paged. */
export type UserFilter = Omit<UserListFilter, "limit" | "offset" | "sortField" | "sortDirection">;

/**
 * Data access for the User aggregate — the ONLY reader and writer of the `user`
 * table.
 *
 * ── WHY THIS TABLE HAS NO "OWNER" EXCEPTION ─────────────────────────────────
 * Every other domain in this deployment reads tables it also writes. `user` is
 * shared with Better Auth, which owns authentication. The boundary is therefore
 * drawn by CONCERN rather than by table: this repository reads and writes
 * profile/administration fields (`name`, `email`, `role`, `banned`) and never
 * touches credentials, sessions or accounts. A password never passes through
 * here, which is what keeps the credential surface in one library.
 */
@Injectable()
export class UserRepository {
	constructor(private readonly database: GlobalDatabaseService) {}

	async findById(id: string): Promise<User | null> {
		const rows = await this.database.db.select().from(user).where(eq(user.id, id)).limit(1);
		const row = rows[0];
		return row === undefined ? null : toUser(row);
	}

	async findByEmail(email: string): Promise<User | null> {
		// The caller normalises before calling, so this is an exact match against a
		// stored canonical value rather than an `ilike` that would match any casing.
		const rows = await this.database.db
			.select()
			.from(user)
			.where(eq(user.email, userRules.normaliseEmail(email)))
			.limit(1);
		const row = rows[0];
		return row === undefined ? null : toUser(row);
	}

	/** Is this address already registered? Backs the uniqueness rule. */
	async emailExists(email: string, excludingId?: string): Promise<boolean> {
		const rows = await this.database.db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.email, userRules.normaliseEmail(email)))
			.limit(2);

		// Excluding the row being updated, so saving a profile without touching the
		// email is not reported as a conflict with itself.
		return rows.some((row) => row.id !== excludingId);
	}

	async list(filter: UserListFilter): Promise<UserPage> {
		const where = buildWhere(filter);
		const column = USER_SORT_COLUMNS[filter.sortField];
		const order = filter.sortDirection === "asc" ? asc(column) : desc(column);

		const [rows, total] = await Promise.all([
			this.database.db
				.select()
				.from(user)
				.where(where)
				.orderBy(order)
				.limit(filter.limit)
				.offset(filter.offset),
			this.database.db.select({ value: count() }).from(user).where(where),
		]);

		return { data: rows.map(toUser), total: total[0]?.value ?? 0 };
	}

	/** The total for the same filter, without loading a page of rows. */
	async count(filter: UserFilter): Promise<number> {
		const rows = await this.database.db
			.select({ value: count() })
			.from(user)
			.where(buildWhere(filter));
		return rows[0]?.value ?? 0;
	}

	/**
	 * Create a row.
	 *
	 * ── WHY THE ID COMES FROM HERE AND NOT FROM THE CALLER ──────────────────
	 * The `user` table is shared with Better Auth, whose ids are opaque strings it
	 * does not let a foreign caller choose. Generating one here keeps the format in
	 * the single place that already knows the column type, and stops a client from
	 * proposing an id — which would let it pre-create a row an auth flow later
	 * adopts.
	 */
	async insert(input: NewUser & { email: string }): Promise<User> {
		const rows = await this.database.db
			.insert(user)
			.values({
				id: crypto.randomUUID(),
				name: input.name,
				email: input.email,
				image: input.image ?? null,
				// `emailVerified` is NOT taken from the input: an account created through
				// administration has not been verified by its owner. Defaulting it to
				// `true` would let an admin mint pre-verified accounts at will.
				emailVerified: false,
				// `banned` is left to the column default, so the database rather than this
				// file is the authority on "not banned".
				...(input.role === undefined ? {} : { role: input.role }),
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.returning();

		const row = rows[0];
		if (row === undefined) {
			// `returning()` on a successful insert always yields a row; its absence is a
			// driver-contract violation, not a user error.
			throw new Error("insert into user returned no row");
		}
		return toUser(row);
	}

	async update(id: string, patch: UserPatch): Promise<User> {
		const rows = await this.database.db
			.update(user)
			.set({
				...(patch.name === undefined ? {} : { name: patch.name }),
				...(patch.email === undefined ? {} : { email: patch.email }),
				...(patch.emailVerified === undefined ? {} : { emailVerified: patch.emailVerified }),
				...(patch.role === undefined ? {} : { role: patch.role }),
				...(patch.banned === undefined ? {} : { banned: patch.banned }),
				// An explicit `Date`, not `sql\`now()\``: the column carries `$onUpdate`, and
				// passing the value keeps the returned row and the stored instant identical
				// rather than the row coming back with a value Drizzle merely assumed.
				updatedAt: new Date(),
			})
			.where(eq(user.id, id))
			.returning();

		const row = rows[0];
		if (row === undefined) {
			// The caller resolved the user first, so its absence here means it was
			// deleted between the two statements.
			throw new Error(`user ${id} disappeared between read and write`);
		}
		return toUser(row);
	}

	async delete(id: string): Promise<void> {
		// Sessions and accounts cascade at the database level (`onDelete: "cascade"`),
		// so no cleanup is issued here — reimplementing the cascade would be a second,
		// drifting definition of what deleting a user means.
		await this.database.db.delete(user).where(eq(user.id, id));
	}
}

/** Sort field → column, so a sort key can never become raw SQL. */
const USER_SORT_COLUMNS = {
	createdAt: user.createdAt,
	name: user.name,
	email: user.email,
	updatedAt: user.updatedAt,
} as const;

/**
 * Compose the WHERE clause from the filters the caller actually supplied.
 *
 * ── WHY `undefined` AND NOT AN EMPTY `and()` ────────────────────────────────
 * `and()` with no conditions renders `WHERE 1 = 1`, which is harmless for Postgres
 * and misleading for a reader (and for the planner's row estimate). `undefined`
 * means the statement genuinely has no WHERE clause.
 *
 * ── WHY THE ARRAY IS TYPED ──────────────────────────────────────────────────
 * An empty `[]` literal infers `never[]`, and `and(...never[])` then rejects every
 * condition as unassignable — a type error that appears only once the first filter
 * is added, which is a confusing place to discover it.
 */
function buildWhere(filter: UserFilter): SQL | undefined {
	const conditions: SQL[] = [];

	const id = equalityCondition(user.id, filter.id);
	if (id !== undefined) conditions.push(id);

	// Email and name match CASE-INSENSITIVELY. A search box that returns nothing for
	// "Alice" when the row says "alice" reads as "the user does not exist", which is
	// the most common way an administrator concludes their data is gone.
	const email = textCondition(user.email, filter.email);
	if (email !== undefined) conditions.push(email);

	const name = textCondition(user.name, filter.name);
	if (name !== undefined) conditions.push(name);

	if (typeof filter.emailVerified === "boolean") {
		conditions.push(eq(user.emailVerified, filter.emailVerified));
	}

	const createdAt = rangeCondition(user.createdAt, filter.createdAt);
	if (createdAt !== undefined) conditions.push(createdAt);

	return conditions.length === 0 ? undefined : and(...conditions);
}

/** `eq` for a column whose declared operator set is a single equality. */
function equalityCondition(column: typeof user.id, filter: OperatorFilter | undefined): SQL | undefined {
	if (filter === undefined || filter.operator !== "eq") return undefined;
	return typeof filter.value === "string" ? eq(column, filter.value) : undefined;
}

/**
 * A text column's operators.
 *
 * ── WHY THE PARAMETER IS `AnyColumn` ────────────────────────────────────────
 * Drizzle's column types carry the column NAME in their generics, so
 * `typeof user.email` and `typeof user.name` are distinct types that happen to
 * behave identically. Naming either one would make this function usable for that
 * column and a type error for the other. `AnyColumn` asks for what the function
 * actually needs — a column — which is the same choice the project repository made
 * for its `SORT_COLUMNS` map.
 *
 * `like` and `ilike` both become `ilike`, on purpose: the distinction is a Postgres
 * quirk (case-sensitivity), not something a user is choosing between, and honouring
 * `like` literally would make two filters that look identical in the UI behave
 * differently depending on the case of what was typed.
 */
function textCondition(column: AnyColumn, filter: OperatorFilter | undefined): SQL | undefined {
	if (filter === undefined || typeof filter.value !== "string") return undefined;
	const value = filter.value;
	if (filter.operator === "eq") return eq(column, value);
	if (filter.operator === "like" || filter.operator === "ilike") return ilike(column, `%${value}%`);
	return undefined;
}

/**
 * A timestamp column's operators.
 *
 * The bounds arrive as `Date` because the contract's schema for this field is
 * `z.date()`: Zod has already coerced the query string by the time it reaches
 * here, so parsing again would be a second, disagreeing interpretation.
 */
function rangeCondition(column: typeof user.createdAt, filter: OperatorFilter | undefined): SQL | undefined {
	if (filter === undefined) return undefined;
	const bounds = toBounds(filter.value);
	if (bounds === undefined) return undefined;

	switch (filter.operator) {
		case "gt":
			return gt(column, bounds[0]);
		case "gte":
			return gte(column, bounds[0]);
		case "lt":
			return lt(column, bounds[0]);
		case "lte":
			return lte(column, bounds[0]);
		case "between":
			// `between` is the one operator whose VALUE is a pair. A `between` carrying a
			// single bound is a malformed request, and treating it as a `gte` would answer
			// a question nobody asked — so it is dropped instead of guessed at.
			return bounds.length === 2 ? and(gte(column, bounds[0]), lte(column, bounds[1])) : undefined;
		default:
			return undefined;
	}
}

/** Normalise an operator's payload into the bounds it applies to the column. */
function toBounds(value: unknown): [Date, Date] | [Date] | undefined {
	const raw = Array.isArray(value) ? value : [value];
	const dates: Date[] = [];
	for (const item of raw) {
		if (!(item instanceof Date) || Number.isNaN(item.getTime())) return undefined;
		dates.push(item);
	}
	if (dates.length === 1) return [dates[0] as Date];
	if (dates.length === 2) return [dates[0] as Date, dates[1] as Date];
	return undefined;
}

/**
 * Map a database row to the domain entity.
 *
 * ── WHY TIMESTAMPS SURVIVE AS `Date` HERE ───────────────────────────────────
 * This is the opposite of the project domain's mapper, deliberately: `userSchema`
 * declares `createdAt: z.date()` while `projectSchema` declares an ISO string. The
 * contract is the authority in both cases, so the mapper satisfies the contract
 * rather than applying a house style. Converting here would fail the output
 * validation — and that asymmetry is the contract telling the truth about what each
 * entity's clients expect.
 *
 * `role` and `banned` are narrowed because the COLUMNS are looser than the
 * contract: `role` is `text` with a default and `banned` is a nullable boolean,
 * while the schema declares an enum and an optional boolean.
 */
function toUser(row: typeof user.$inferSelect): User {
	const role = toRole(row.role);
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		emailVerified: row.emailVerified,
		image: row.image ?? null,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...(role === undefined ? {} : { role }),
		...(row.banned === null ? {} : { banned: row.banned }),
	};
}

/**
 * Narrow a `text` column into the role union.
 *
 * `undefined` for an unrecognised value rather than a cast: a row holding a role
 * that has been removed from the builder is a data problem, and reporting it as
 * "no role" makes the user fall back to the LEAST privilege. A cast would hand an
 * unknown string to every authorisation check in the platform.
 */
function toRole(value: string): User["role"] | undefined {
	const known: ReadonlySet<string> = new Set(["superAdmin", "admin", "operator", "viewer"]);
	return known.has(value) ? (value as User["role"]) : undefined;
}
