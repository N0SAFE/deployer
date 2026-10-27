import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	gte,
	ilike,
	lt,
	lte,
	type AnyColumn,
	type SQL,
} from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";

import type { User } from "../domain/user.types";
import type { OperatorFilter, UserFilter } from "./user.repository.types";

/** Sort field → column, so a sort key can never become raw SQL. */
export const USER_SORT_COLUMNS = {
	createdAt: user.createdAt,
	name: user.name,
	email: user.email,
	updatedAt: user.updatedAt,
} as const;

export const USER_SORT_ORDER = { asc, desc } as const;

export function buildWhere(filter: UserFilter): SQL | undefined {
	const conditions: SQL[] = [];

	const id = equalityCondition(user.id, filter.id);
	if (id !== undefined) conditions.push(id);

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

function equalityCondition(
	column: typeof user.id,
	filter: OperatorFilter | undefined,
): SQL | undefined {
	if (filter?.operator !== "eq") return undefined;
	return typeof filter.value === "string" ? eq(column, filter.value) : undefined;
}

function textCondition(column: AnyColumn, filter: OperatorFilter | undefined): SQL | undefined {
	if (typeof filter?.value !== "string") return undefined;
	const value = filter.value;
	if (filter.operator === "eq") return eq(column, value);
	if (filter.operator === "like" || filter.operator === "ilike") return ilike(column, `%${value}%`);
	return undefined;
}

function rangeCondition(
	column: typeof user.createdAt,
	filter: OperatorFilter | undefined,
): SQL | undefined {
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
			return bounds.length === 2 ? and(gte(column, bounds[0]), lte(column, bounds[1])) : undefined;
		default:
			return undefined;
	}
}

function toBounds(value: unknown): [Date, Date] | [Date] | undefined {
	const raw = Array.isArray(value) ? value : [value];
	const dates: Date[] = [];
	for (const item of raw) {
		if (!(item instanceof Date) || Number.isNaN(item.getTime())) return undefined;
		dates.push(item);
	}
	const [first, second] = dates;
	if (first === undefined) return undefined;
	if (dates.length === 1) return [first];
	if (dates.length === 2 && second !== undefined) return [first, second];
	return undefined;
}

export function toUser(row: typeof user.$inferSelect): User {
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

function toRole(value: string): User["role"] | undefined {
	const known: ReadonlySet<string> = new Set(["superAdmin", "admin", "operator", "viewer"]);
	return known.has(value) ? (value as User["role"]) : undefined;
}

export { count };
