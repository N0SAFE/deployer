import { Injectable } from "@nestjs/common";
import { Context, Effect } from "effect";
import { asc, count, desc, eq } from "drizzle-orm";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { DatabasePort } from "@identity/core/database/database.port";

import { userRules } from "../domain/user.rules";
import type { NewUser, User, UserPatch } from "../domain/user.types";
import { UserRepositoryFailure } from "../user.failures";
import { attempt } from "./user.repository.utils";
import type {
	UserFilter,
	UserListFilter,
	UserPage,
} from "./user.repository.types";
import { buildWhere, toUser, USER_SORT_COLUMNS } from "./user.repository.sql";

/** The repository contract, declared BEFORE the implementation. */
export type UserRepositoryShape = {
	readonly findById: (id: string) => Effect.Effect<User | null, UserRepositoryFailure, DatabasePort>;
	readonly findByEmail: (email: string) => Effect.Effect<User | null, UserRepositoryFailure, DatabasePort>;
	readonly emailExists: (
		email: string,
		excludingId?: string,
	) => Effect.Effect<boolean, UserRepositoryFailure, DatabasePort>;
	readonly list: (filter: UserListFilter) => Effect.Effect<UserPage, UserRepositoryFailure, DatabasePort>;
	readonly count: (filter: UserFilter) => Effect.Effect<number, UserRepositoryFailure, DatabasePort>;
	readonly insert: (
		input: NewUser & { email: string },
	) => Effect.Effect<User, UserRepositoryFailure, DatabasePort>;
	readonly update: (id: string, patch: UserPatch) => Effect.Effect<User, UserRepositoryFailure, DatabasePort>;
	readonly delete: (id: string) => Effect.Effect<void, UserRepositoryFailure, DatabasePort>;
}

/** Effect key = NestJS token. The Drizzle implementation is below. */
export class UserRepository extends Context.Service<UserRepository, UserRepositoryShape>()(
	"identity/UserRepository",
) {}

/** Drizzle implementation. No constructor injection: every method yields `DatabasePort`. */
@Injectable()
export class UserRepositoryImpl implements UserRepositoryShape {
	findById(id: string): Effect.Effect<User | null, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
				const row = rows[0];
				return row === undefined ? null : toUser(row);
			});
		});
	}

	findByEmail(email: string): Effect.Effect<User | null, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.select()
					.from(user)
					.where(eq(user.email, userRules.normaliseEmail(email)))
					.limit(1);
				const row = rows[0];
				return row === undefined ? null : toUser(row);
			});
		});
	}

	emailExists(email: string, excludingId?: string): Effect.Effect<boolean, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.select({ id: user.id })
					.from(user)
					.where(eq(user.email, userRules.normaliseEmail(email)))
					.limit(2);
				return rows.some((row) => row.id !== excludingId);
			});
		});
	}

	list(filter: UserListFilter): Effect.Effect<UserPage, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const where = buildWhere(filter);
				const column = USER_SORT_COLUMNS[filter.sortField];
				const order = filter.sortDirection === "asc" ? asc(column) : desc(column);

				const [rows, total] = await Promise.all([
					db
						.select()
						.from(user)
						.where(where)
						.orderBy(order)
						.limit(filter.limit)
						.offset(filter.offset),
					db.select({ value: count() }).from(user).where(where),
				]);

				return { data: rows.map(toUser), total: total[0]?.value ?? 0 };
			});
		});
	}

	count(filter: UserFilter): Effect.Effect<number, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db.select({ value: count() }).from(user).where(buildWhere(filter));
				return rows[0]?.value ?? 0;
			});
		});
	}

	insert(input: NewUser & { email: string }): Effect.Effect<User, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.insert(user)
					.values({
						id: crypto.randomUUID(),
						name: input.name,
						email: input.email,
						image: input.image ?? null,
						emailVerified: false,
						...(input.role === undefined ? {} : { role: input.role }),
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning();

				const row = rows[0];
				if (row === undefined) throw new Error("insert into user returned no row");
				return toUser(row);
			});
		});
	}

	update(id: string, patch: UserPatch): Effect.Effect<User, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.update(user)
					.set({
						...(patch.name === undefined ? {} : { name: patch.name }),
						...(patch.email === undefined ? {} : { email: patch.email }),
						...(patch.emailVerified === undefined ? {} : { emailVerified: patch.emailVerified }),
						...(patch.role === undefined ? {} : { role: patch.role }),
						...(patch.banned === undefined ? {} : { banned: patch.banned }),
						updatedAt: new Date(),
					})
					.where(eq(user.id, id))
					.returning();

				const row = rows[0];
				if (row === undefined) throw new Error(`user ${id} disappeared between read and write`);
				return toUser(row);
			});
		});
	}

	delete(id: string): Effect.Effect<void, UserRepositoryFailure, DatabasePort> {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				await db.delete(user).where(eq(user.id, id));
			});
		});
	}
}
