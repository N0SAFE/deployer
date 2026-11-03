import { Context, Effect } from "effect";


import { CurrentActor, serviceOver } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { roleHasPermission } from "@identity/core/authz/role-catalog";
import { DatabasePort } from "@identity/core/database/database.port";
import { actorFromCurrent } from "@identity/core/utils/actor.utils";

import {
	AuditRepository,
	type AuditPage,
	type AuditQuery,
	type AuditRow,
	type NewAuditEvent,
} from "./audit.repository";

export type AuditExport = {
	readonly csv: string;
	readonly rows: number;
	readonly truncated: boolean;
};

export type AuditServiceShape = {
	/**
	 * Append one event from a use case.
	 *
	 * Not a capability: the producer is inside the service, not a caller. Failures are SWALLOWED — an audit write that
	 * fails must not turn a successful role change into a 500, which would invite retrying the change (and write twice).
	 */
	readonly record: (
		event: NewAuditEvent,
	) => Effect.Effect<void, never, DatabasePort>;
	readonly list: (
		query: AuditQuery,
	) => Effect.Effect<AuditPage, ForbiddenError, AuditRepository | CurrentActor | DatabasePort>;
	/** The same rows as CSV, for the caller holding `audit:export`. */
	readonly export: (
		query: AuditQuery,
	) => Effect.Effect<AuditExport, ForbiddenError, AuditRepository | CurrentActor | DatabasePort>;
};

const CSV_HEADER = ["id", "createdAt", "action", "actorId", "targetId", "ip", "userAgent", "detail"] as const;

/** One CSV cell: quotes doubled, the field wrapped only when it carries a separator. */
function cell(value: unknown): string {
	const text =
		value === null || value === undefined
			? ""
			: value instanceof Date
				? value.toISOString()
				: typeof value === "string" || typeof value === "number" || typeof value === "boolean"
					? String(value)
					: JSON.stringify(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Pure so the shape of an export is testable without a database. */
export function auditRowsToCsv(rows: readonly AuditRow[]): string {
	const lines = rows.map((row) =>
		[
			row.id,
			row.createdAt,
			row.action,
			row.actorId,
			row.targetId,
			row.ip,
			row.userAgent,
			JSON.stringify(row.detail),
		]
			.map(cell)
			.join(","),
	);
	return [CSV_HEADER.join(","), ...lines].join("\n");
}

/**
 * Reading the audit log is a CAPABILITY, not a role: `audit:read` / `audit:export` are what the routes need, and the
 * checks name the permission so a custom role holding one works without a code change. Export is its own capability:
 * taking the whole trail away is a wider disclosure than browsing a page of it.
 */
const makeAuditService = (repository: AuditRepository["Service"]): AuditServiceShape => ({
	record: (event): ReturnType<AuditServiceShape["record"]> =>
		repository
			.append(event)
			.pipe(Effect.catchCause(() => Effect.logWarning(`audit write failed for "${event.action}"`))),

	list: (query): ReturnType<AuditServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleHasPermission(actor.role, "audit:read")) {
				return yield* Effect.fail(new ForbiddenError("actor lacks audit:read"));
			}
			return yield* repository.list(query);
		}),

	export: (query): ReturnType<AuditServiceShape["export"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleHasPermission(actor.role, "audit:export")) {
				return yield* Effect.fail(new ForbiddenError("actor lacks audit:export"));
			}
			const page = yield* repository.list(query);
			return {
				csv: auditRowsToCsv(page.data),
				rows: page.data.length,
				// The repository fetches `limit + 1`; `hasMore` therefore means "the cap cut the result", which an export
				// must say out loud rather than silently truncate.
				truncated: page.meta.hasMore,
			};
		}),
});

export class AuditService extends Context.Service<AuditService, AuditServiceShape>()("identity/AuditService") {
	static readonly live = serviceOver(AuditRepository, makeAuditService);
}
