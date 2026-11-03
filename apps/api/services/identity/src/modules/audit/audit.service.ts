import { Context, Effect } from "effect";

import { roleGrants } from "@deployer/auth/authz";
import { ForbiddenError } from "@deployer/errors";
import { CurrentActor, serviceOver } from "@deployer/effect-core";

import { DatabasePort } from "@identity/core/database/database.port";
import { actorFromCurrent } from "@identity/core/utils/actor.utils";

import { AuditRepository, type AuditPage, type AuditQuery, type AuditRow } from "./audit.repository";

export type AuditExport = {
	readonly csv: string;
	readonly rows: number;
	readonly truncated: boolean;
};

export type AuditServiceShape = {
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
	const text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
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
	list: (query): ReturnType<AuditServiceShape["list"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleGrants(actor.role, "audit:read")) {
				return yield* Effect.fail(new ForbiddenError("actor lacks audit:read"));
			}
			return yield* repository.list(query);
		}),

	export: (query): ReturnType<AuditServiceShape["export"]> =>
		Effect.gen(function* () {
			const actor = actorFromCurrent(yield* CurrentActor);
			if (!roleGrants(actor.role, "audit:export")) {
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
