import { and, count, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Context, Data, Effect } from "effect";

import { serviceOver } from "@deployer/effect-core";
import { accessRequestVotes, accessRequests, user } from "@deployer/nest-schema/global/identity/index";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

/** A driver failure, kept separate from the domain's own refusals. */
export class ApprovalRepositoryFailure extends Data.TaggedError("ApprovalRepositoryFailure")<{
	readonly cause: unknown;
}> {}

export type AccessRequestRow = {
	readonly id: string;
	readonly permission: string;
	readonly requesterId: string;
	/** Joined for display: who asked, in words. */
	readonly requesterName: string | null;
	readonly via: string | null;
	readonly scope: Record<string, unknown>;
	readonly actionHash: string;
	readonly reason: string;
	readonly requiredApprovals: number;
	readonly status: "pending" | "approved" | "denied" | "expired" | "consumed";
	readonly ttlSec: number;
	readonly expiresAt: Date;
	readonly consumedAt: Date | null;
	readonly createdAt: Date;
	readonly approvals: number;
};

export type NewAccessRequest = {
	readonly permission: string;
	readonly requesterId: string;
	readonly via: string | null;
	readonly scope: Record<string, unknown>;
	readonly actionHash: string;
	readonly reason: string;
	readonly requiredApprovals: number;
	readonly ttlSec: number;
	readonly expiresAt: Date;
};

export type AccessRequestFilter = {
	readonly status: AccessRequestRow["status"];
	readonly limit: number;
};

export type AccessRequestVote = "approve" | "deny";

export type ApprovalRepositoryShape = {
	readonly create: (
		request: NewAccessRequest,
	) => Effect.Effect<AccessRequestRow, ApprovalRepositoryFailure, DatabasePort>;
	readonly findById: (
		id: string,
	) => Effect.Effect<AccessRequestRow | null, ApprovalRepositoryFailure, DatabasePort>;
	readonly list: (
		filter: AccessRequestFilter,
	) => Effect.Effect<AccessRequestRow[], ApprovalRepositoryFailure, DatabasePort>;
	/**
	 * Mark pending requests past their expiry as `expired`.
	 *
	 * Lazily, when the queue is read: a row that can no longer be approved must not sit in the inbox looking actionable,
	 * and a sweeper job for a column comparison would be more moving parts than the problem deserves.
	 */
	readonly expireStale: (now: Date) => Effect.Effect<void, ApprovalRepositoryFailure, DatabasePort>;
	/** How many accounts hold any role that can approve — the solo-mode probe (`DEC-AUTH-16`). */
	readonly countApprovers: (roleNames: readonly string[]) => Effect.Effect<number, ApprovalRepositoryFailure, DatabasePort>;
	/** The role a requester holds, read from the account — a peer names the actor, not their role. */
	readonly roleOf: (userId: string) => Effect.Effect<string | null, ApprovalRepositoryFailure, DatabasePort>;
	/**
	 * Record one person's verdict and settle the request in the SAME transaction.
	 *
	 * A deny closes it immediately; an approve closes it when the distinct-approver count reaches `requiredApprovals`.
	 * The vote insert ignores a duplicate, so a double click cannot count twice.
	 */
	readonly vote: (
		id: string,
		approverId: string,
		decision: AccessRequestVote,
		proofHash: string | null,
	) => Effect.Effect<AccessRequestRow | null, ApprovalRepositoryFailure, DatabasePort>;
	/**
	 * Spend an approval exactly once.
	 *
	 * One `UPDATE … WHERE status = 'approved' AND action_hash = $h AND expires_at > now RETURNING id`: the database
	 * decides the winner, so two retries of the same action cannot both proceed.
	 */
	readonly consume: (
		requesterId: string,
		actionHash: string,
		now: Date,
	) => Effect.Effect<boolean, ApprovalRepositoryFailure, DatabasePort>;
};

/** The row projection every read shares: the request plus how many DISTINCT people approved it. */
const rowSelection = {
	id: accessRequests.id,
	permission: accessRequests.permission,
	requesterId: accessRequests.requesterId,
	// Aggregated, not selected: the row is grouped by id and a plain joined column would need a second GROUP BY key.
	requesterName: sql<string | null>`max(${user.name})`,
	via: accessRequests.via,
	scope: accessRequests.scope,
	actionHash: accessRequests.actionHash,
	reason: accessRequests.reason,
	requiredApprovals: accessRequests.requiredApprovals,
	status: accessRequests.status,
	ttlSec: accessRequests.ttlSec,
	expiresAt: accessRequests.expiresAt,
	consumedAt: accessRequests.consumedAt,
	createdAt: accessRequests.createdAt,
	approvals: sql<number>`count(${accessRequestVotes.approverId}) filter (where ${accessRequestVotes.decision} = 'approve')`.mapWith(Number),
} as const;

const attempt = <T>(operation: () => Promise<T>) =>
	Effect.tryPromise({ try: operation, catch: (cause) => new ApprovalRepositoryFailure({ cause }) });

function makeApprovalRepository(db: DatabaseShape["db"]): ApprovalRepositoryShape {
	/** One row by id, with its approvals — the shape every write returns. */
	const readById = async (id: string): Promise<AccessRequestRow | null> => {
		const [row] = await db
			.select(rowSelection)
			.from(accessRequests)
			.leftJoin(accessRequestVotes, eq(accessRequestVotes.requestId, accessRequests.id))
			.leftJoin(user, eq(user.id, accessRequests.requesterId))
			.where(eq(accessRequests.id, id))
			.groupBy(accessRequests.id);
		return (row as AccessRequestRow | undefined) ?? null;
	};

	return {
		create: (request) =>
			attempt(async () => {
				const [created] = await db.insert(accessRequests).values(request).returning({ id: accessRequests.id });
				if (created === undefined) throw new Error("access request insert returned no row");
				const row = await readById(created.id);
				if (row === null) throw new Error("access request vanished after insert");
				return row;
			}),

		expireStale: (now) =>
			attempt(async () => {
				await db
					.update(accessRequests)
					.set({ status: "expired" })
					.where(and(eq(accessRequests.status, "pending"), lt(accessRequests.expiresAt, now)));
			}),

		countApprovers: (roleNames) =>
			attempt(async () => {
				if (roleNames.length === 0) return 0;
				const [row] = await db
					.select({ value: count() })
					.from(user)
					.where(inArray(user.role, [...roleNames]));
				return row?.value ?? 0;
			}),

		roleOf: (userId) =>
			attempt(async () => {
				const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
				return row?.role ?? null;
			}),

		findById: (id) => attempt(() => readById(id)),

		list: (filter) =>
			attempt(async () => {
				const rows = await db
					.select(rowSelection)
					.from(accessRequests)
					.leftJoin(accessRequestVotes, eq(accessRequestVotes.requestId, accessRequests.id))
					.leftJoin(user, eq(user.id, accessRequests.requesterId))
					.where(eq(accessRequests.status, filter.status))
					.groupBy(accessRequests.id)
					.orderBy(desc(accessRequests.createdAt))
					.limit(filter.limit);
				return rows as AccessRequestRow[];
			}),

		vote: (id, approverId, decision, proofHash) =>
			attempt(() =>
				db.transaction(async (tx) => {
					await tx
						.insert(accessRequestVotes)
						.values({ requestId: id, approverId, decision, proofHash })
						// A second click by the same person is not a second vote.
						.onConflictDoNothing({ target: [accessRequestVotes.requestId, accessRequestVotes.approverId] });

					if (decision === "deny") {
						await tx
							.update(accessRequests)
							.set({ status: "denied" })
							.where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")));
					} else {
						const [row] = await tx
							.select({ required: accessRequests.requiredApprovals })
							.from(accessRequests)
							.where(eq(accessRequests.id, id));
						const [{ value: yes } = { value: 0 }] = await tx
							.select({ value: count() })
							.from(accessRequestVotes)
							.where(and(eq(accessRequestVotes.requestId, id), eq(accessRequestVotes.decision, "approve")));

						if (row !== undefined && yes >= row.required) {
							await tx
								.update(accessRequests)
								.set({ status: "approved" })
								.where(and(eq(accessRequests.id, id), eq(accessRequests.status, "pending")));
						}
					}

					return readById(id);
				}),
			),

		consume: (requesterId, actionHash, now) =>
			attempt(async () => {
				const spent = await db
					.update(accessRequests)
					.set({ status: "consumed", consumedAt: now })
					.where(
						and(
							eq(accessRequests.requesterId, requesterId),
							eq(accessRequests.actionHash, actionHash),
							eq(accessRequests.status, "approved"),
							gt(accessRequests.expiresAt, now),
						),
					)
					.returning({ id: accessRequests.id });
				return spent.length > 0;
			}),
	};
}

/** The approval ledger: requests, votes and the one-shot consume. */
export class ApprovalRepository extends Context.Service<ApprovalRepository, ApprovalRepositoryShape>()(
	"identity/ApprovalRepository",
) {
	static readonly live = serviceOver(DatabasePort, ({ db }) => makeApprovalRepository(db));
}
