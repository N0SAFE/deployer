import { and, desc, eq, lt } from "drizzle-orm";
import { Context, Effect } from "effect";

import { serviceOver } from "@deployer/effect-core";
import { authAuditEvents } from "@deployer/nest-schema/global/identity/audit";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

/** One audit row, as the viewer reads it. */
export type AuditRow = {
	readonly id: number;
	readonly action: string;
	readonly actorId: string | null;
	readonly targetId: string | null;
	readonly ip: string | null;
	readonly userAgent: string | null;
	readonly detail: Record<string, unknown>;
	readonly createdAt: Date;
};

export type AuditQuery = {
	readonly action?: string;
	readonly actorId?: string;
	readonly targetId?: string;
	readonly limit: number;
	readonly beforeId?: number;
};

export type AuditPage = {
	readonly data: AuditRow[];
	readonly meta: { readonly limit: number; readonly hasMore: boolean };
};

/** One event to append. `action` comes from the catalog in `@deployer/auth/audit`. */
export type NewAuditEvent = {
	readonly action: string;
	readonly actorId?: string | undefined;
	readonly targetId?: string | undefined;
	readonly ip?: string | undefined;
	readonly userAgent?: string | undefined;
	readonly detail?: Record<string, unknown> | undefined;
};

export type AuditRepositoryShape = {
	readonly list: (query: AuditQuery) => Effect.Effect<AuditPage, never, DatabasePort>;
	/** Append one event. Writes never read back; the trail is append-only by construction. */
	readonly append: (event: NewAuditEvent) => Effect.Effect<void, never, DatabasePort>;
};

const makeAuditRepository = (database: DatabaseShape): AuditRepositoryShape => ({
	append: (event) =>
		Effect.promise(async () => {
			await database.db.insert(authAuditEvents).values({
				action: event.action,
				actorId: event.actorId ?? null,
				targetId: event.targetId ?? null,
				ip: event.ip ?? null,
				userAgent: event.userAgent ?? null,
				detail: event.detail ?? {},
			});
		}),

	list: (query) =>
		Effect.promise(async () => {
			const conditions = [
				...(query.action === undefined ? [] : [eq(authAuditEvents.action, query.action)]),
				...(query.actorId === undefined ? [] : [eq(authAuditEvents.actorId, query.actorId)]),
				...(query.targetId === undefined ? [] : [eq(authAuditEvents.targetId, query.targetId)]),
				...(query.beforeId === undefined ? [] : [lt(authAuditEvents.id, query.beforeId)]),
			];
			const rows = await database.db
				.select()
				.from(authAuditEvents)
				.where(conditions.length === 0 ? undefined : and(...conditions))
				.orderBy(desc(authAuditEvents.id))
				.limit(query.limit + 1);

			const hasMore = rows.length > query.limit;
			return {
				data: (hasMore ? rows.slice(0, query.limit) : rows).map((row) => ({
					id: row.id,
					action: row.action,
					actorId: row.actorId,
					targetId: row.targetId,
					ip: row.ip,
					userAgent: row.userAgent,
					detail: row.detail,
					createdAt: row.createdAt,
				})),
				meta: { limit: query.limit, hasMore },
			};
		}),
});

/** Append-only auth audit reads. */
export class AuditRepository extends Context.Service<AuditRepository, AuditRepositoryShape>()(
	"identity/AuditRepository",
) {
	static readonly live = serviceOver(DatabasePort, makeAuditRepository);
}
