import { randomUUID } from "node:crypto";

import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { Context, Effect } from "effect";

import type {
	DeploymentDeadLetterJob,
	DeploymentDeadLetterListInput,
	DeploymentQueueClaimInput,
	DeploymentQueueEnqueueInput,
	DeploymentQueueFailInput,
	DeploymentQueueHeartbeatInput,
	DeploymentQueueJob,
} from "@deployer/contracts-entities";
import type { DbError, DbShape } from "@deployer/effect-infra";
import { deploymentDeadLetterJobs, deploymentQueueJobs } from "@deployer/nest-schema/global/runtime/deployment-queue";
import type { GlobalDatabase } from "@deployer/shared/core/modules/database/services/global-database.service";

type JobRow = typeof deploymentQueueJobs.$inferSelect;
type DeadLetterRow = typeof deploymentDeadLetterJobs.$inferSelect;

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export const toQueueJob = (row: JobRow): DeploymentQueueJob => ({
	id: row.id,
	type: row.type,
	status: row.status,
	idempotencyKey: row.idempotencyKey,
	workerId: row.workerId,
	lockToken: row.lockToken,
	payload: row.payload,
	attempts: row.attempts,
	maxAttempts: row.maxAttempts,
	availableAt: row.availableAt.toISOString(),
	lastHeartbeatAt: iso(row.lastHeartbeatAt),
	leaseExpiresAt: iso(row.leaseExpiresAt),
	connectivityStatus: row.connectivityStatus as DeploymentQueueJob["connectivityStatus"],
	startedAt: iso(row.startedAt),
	completedAt: iso(row.completedAt),
	lastError: row.lastError,
	metadata: row.metadata,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

const toDeadLetter = (row: DeadLetterRow): DeploymentDeadLetterJob => ({
	id: row.id,
	originalJobId: row.originalJobId,
	idempotencyKey: row.idempotencyKey,
	type: row.type,
	payload: row.payload,
	reason: row.reason,
	attempts: row.attempts,
	maxAttempts: row.maxAttempts,
	lastError: row.lastError,
	movedAt: row.movedAt.toISOString(),
	movedBy: row.movedBy,
	replayCount: row.replayCount,
	lastReplayAt: iso(row.lastReplayAt),
	metadata: row.metadata,
});

/** How soon after a lease is reaped the job can be claimed again (avoids a hot re-claim). */
export const REAPED_AVAILABLE_DELAY_MS = 1_000;
/** Default delay before a retryable failure is claimable again. */
export const DEFAULT_RETRY_DELAY_MS = 5_000;

export type QueueListFilters = {
	readonly type?: DeploymentQueueJob["type"];
	readonly status?: DeploymentQueueJob["status"];
	readonly workerId?: string;
	readonly deploymentId?: string;
	readonly serviceId?: string;
	readonly projectId?: string;
	readonly limit: number;
	readonly offset: number;
};

export type FailOutcome = {
	readonly job: DeploymentQueueJob;
	readonly movedToDeadLetter: boolean;
	readonly deadLetterJob: DeploymentDeadLetterJob | null;
};

/**
 * The durable deployment queue. A worker claims rows with `FOR UPDATE SKIP LOCKED`, holds each under a
 * lease it renews, and every write that ends a claim is guarded by the worker id AND the lock token, so a
 * worker that lost its lease can never overwrite the job's new owner. Every method fails only with `DbError`.
 */
export type DeploymentQueueRepositoryShape = {
	/** Idempotent on the key: the second enqueue returns the first job with `deduplicated: true`. */
	readonly enqueue: (input: DeploymentQueueEnqueueInput) => Effect.Effect<{ job: DeploymentQueueJob; deduplicated: boolean }, DbError>;
	readonly claim: (input: DeploymentQueueClaimInput) => Effect.Effect<DeploymentQueueJob[], DbError>;
	readonly claimByIdempotencyKey: (key: string, input: DeploymentQueueClaimInput) => Effect.Effect<DeploymentQueueJob | null, DbError>;
	/** Null when the caller no longer holds the lease. */
	readonly heartbeat: (jobId: string, input: DeploymentQueueHeartbeatInput) => Effect.Effect<DeploymentQueueJob | null, DbError>;
	readonly complete: (
		jobId: string,
		workerId: string,
		lockToken: string,
		result: Record<string, unknown> | undefined,
	) => Effect.Effect<DeploymentQueueJob | null, DbError>;
	/** Retries (re-queues) or dead-letters; null when the caller no longer holds the lease. */
	readonly fail: (jobId: string, input: DeploymentQueueFailInput) => Effect.Effect<FailOutcome | null, DbError>;
	/** Cancels a job that has not finished; null when it is already terminal or unknown. */
	readonly cancel: (jobId: string, reason: string) => Effect.Effect<DeploymentQueueJob | null, DbError>;
	/** Returns every job whose lease expired to the claimable pool and gives the released rows back. */
	readonly reapExpiredLeases: (now?: Date) => Effect.Effect<DeploymentQueueJob[], DbError>;
	readonly findById: (jobId: string) => Effect.Effect<DeploymentQueueJob | null, DbError>;
	readonly list: (filters: QueueListFilters) => Effect.Effect<{ items: DeploymentQueueJob[]; total: number }, DbError>;
	readonly hasLiveJobForDeployment: (deploymentId: string) => Effect.Effect<boolean, DbError>;
	/** Every queued, claimed or running job of a deployment. */
	readonly liveJobsForDeployment: (deploymentId: string) => Effect.Effect<DeploymentQueueJob[], DbError>;
	readonly listDeadLetters: (
		input: DeploymentDeadLetterListInput,
	) => Effect.Effect<{ items: DeploymentDeadLetterJob[]; total: number }, DbError>;
	readonly findDeadLetter: (id: string) => Effect.Effect<DeploymentDeadLetterJob | null, DbError>;
	/** Enqueues a replay of a dead letter and bumps its counter; null when the dead letter does not exist. */
	readonly replayDeadLetter: (
		id: string,
		replay: { payload: DeploymentQueueJob["payload"]; availableAt?: string | undefined; metadata: Record<string, unknown> },
	) => Effect.Effect<{ job: DeploymentQueueJob; deadLetter: DeploymentDeadLetterJob } | null, DbError>;
};

export class DeploymentQueueRepository extends Context.Service<DeploymentQueueRepository, DeploymentQueueRepositoryShape>()(
	"runtime/DeploymentQueueRepository",
) {}

const LIVE_STATUSES = ["queued", "claimed", "running"] as const;
const HELD_STATUSES = ["claimed", "running"] as const;

export function makeDeploymentQueueRepository(database: DbShape<GlobalDatabase>): DeploymentQueueRepositoryShape {
	const { use, transaction } = database;

	/** The job `jobId` while `workerId` still holds it under `lockToken`. */
	const heldBy = (jobId: string, workerId: string, lockToken: string): SQL =>
		sql`${eq(deploymentQueueJobs.id, jobId)} and ${eq(deploymentQueueJobs.workerId, workerId)} and ${eq(deploymentQueueJobs.lockToken, lockToken)} and ${inArray(deploymentQueueJobs.status, [...HELD_STATUSES])}`;

	const claimWhere = (types: readonly DeploymentQueueJob["type"][] | undefined, now: Date): SQL[] => {
		const conditions: SQL[] = [eq(deploymentQueueJobs.status, "queued"), lte(deploymentQueueJobs.availableAt, now)];
		if (types !== undefined && types.length > 0) conditions.push(inArray(deploymentQueueJobs.type, [...types]));
		return conditions;
	};

	const enqueue: DeploymentQueueRepositoryShape["enqueue"] = (input) =>
		use(async (db) => {
			const inserted = await db
				.insert(deploymentQueueJobs)
				.values({
					type: input.type,
					idempotencyKey: input.idempotencyKey,
					payload: input.payload,
					deploymentId: input.payload.deploymentId ?? null,
					maxAttempts: input.maxAttempts,
					...(input.availableAt === undefined ? {} : { availableAt: new Date(input.availableAt) }),
					metadata: input.metadata ?? null,
				})
				.onConflictDoNothing({ target: deploymentQueueJobs.idempotencyKey })
				.returning();
			const created = inserted[0];
			if (created !== undefined) return { job: toQueueJob(created), deduplicated: false };

			const existing = await db
				.select()
				.from(deploymentQueueJobs)
				.where(eq(deploymentQueueJobs.idempotencyKey, input.idempotencyKey))
				.limit(1);
			const row = existing[0];
			if (row === undefined) throw new Error(`idempotency key ${input.idempotencyKey} conflicted but no row exists`);
			return { job: toQueueJob(row), deduplicated: true };
		});

	const claimRows = (conditions: SQL[], input: DeploymentQueueClaimInput, limit: number): Effect.Effect<DeploymentQueueJob[], DbError> =>
		transaction(
			use(async (db) => {
				const now = new Date();
				const candidates = await db
					.select({ id: deploymentQueueJobs.id })
					.from(deploymentQueueJobs)
					.where(and(...conditions))
					.orderBy(deploymentQueueJobs.availableAt, deploymentQueueJobs.createdAt)
					.limit(limit)
					.for("update", { skipLocked: true });
				const claimed: DeploymentQueueJob[] = [];
				for (const candidate of candidates) {
					const [row] = await db
						.update(deploymentQueueJobs)
						.set({
							status: "claimed",
							workerId: input.workerId,
							lockToken: randomUUID(),
							...(input.workerConnectivityStatus === undefined ? {} : { connectivityStatus: input.workerConnectivityStatus }),
							startedAt: sql`coalesce(${deploymentQueueJobs.startedAt}, ${now.toISOString()}::timestamptz)`,
							leaseExpiresAt: new Date(now.getTime() + input.leaseDurationSec * 1000),
							updatedAt: now,
						})
						.where(eq(deploymentQueueJobs.id, candidate.id))
						.returning();
					if (row !== undefined) claimed.push(toQueueJob(row));
				}
				return claimed;
			}),
		);

	const claim: DeploymentQueueRepositoryShape["claim"] = (input) =>
		claimRows(claimWhere(input.types, new Date()), input, input.limit);

	const claimByIdempotencyKey: DeploymentQueueRepositoryShape["claimByIdempotencyKey"] = (key, input) =>
		claimRows([...claimWhere(input.types, new Date()), eq(deploymentQueueJobs.idempotencyKey, key)], input, 1).pipe(
			Effect.map((rows) => rows[0] ?? null),
		);

	const heartbeat: DeploymentQueueRepositoryShape["heartbeat"] = (jobId, input) =>
		use(async (db) => {
			const now = new Date();
			const [row] = await db
				.update(deploymentQueueJobs)
				.set({
					status: "running",
					lastHeartbeatAt: now,
					leaseExpiresAt: new Date(now.getTime() + input.extendLeaseSec * 1000),
					...(input.connectivityStatus === undefined ? {} : { connectivityStatus: input.connectivityStatus }),
					updatedAt: now,
				})
				.where(heldBy(jobId, input.workerId, input.lockToken))
				.returning();
			return row === undefined ? null : toQueueJob(row);
		});

	const complete: DeploymentQueueRepositoryShape["complete"] = (jobId, workerId, lockToken, result) =>
		use(async (db) => {
			const now = new Date();
			const [row] = await db
				.update(deploymentQueueJobs)
				.set({
					status: "succeeded",
					completedAt: now,
					lockToken: null,
					leaseExpiresAt: null,
					...(result === undefined ? {} : { metadata: sql`coalesce(${deploymentQueueJobs.metadata}, '{}'::jsonb) || ${JSON.stringify({ result })}::jsonb` }),
					updatedAt: now,
				})
				.where(heldBy(jobId, workerId, lockToken))
				.returning();
			return row === undefined ? null : toQueueJob(row);
		});

	const fail: DeploymentQueueRepositoryShape["fail"] = (jobId, input) =>
		transaction(
			use(async (db): Promise<FailOutcome | null> => {
				const [held] = await db
					.select()
					.from(deploymentQueueJobs)
					.where(heldBy(jobId, input.workerId, input.lockToken))
					.for("update");
				if (held === undefined) return null;

				const now = new Date();
				const attempts = held.attempts + 1;

				if (input.retryable && attempts < held.maxAttempts) {
					const retryAt = input.retryAt === undefined ? new Date(now.getTime() + DEFAULT_RETRY_DELAY_MS) : new Date(input.retryAt);
					const [row] = await db
						.update(deploymentQueueJobs)
						.set({
							status: "queued",
							attempts,
							availableAt: retryAt,
							lastError: input.error,
							lockToken: null,
							workerId: null,
							leaseExpiresAt: null,
							lastHeartbeatAt: null,
							updatedAt: now,
						})
						.where(eq(deploymentQueueJobs.id, held.id))
						.returning();
					return { job: toQueueJob(row ?? held), movedToDeadLetter: false, deadLetterJob: null };
				}

				const [failed] = await db
					.update(deploymentQueueJobs)
					.set({
						status: "failed",
						attempts,
						lastError: input.error,
						completedAt: now,
						lockToken: null,
						leaseExpiresAt: null,
						updatedAt: now,
					})
					.where(eq(deploymentQueueJobs.id, held.id))
					.returning();
				const failedRow = failed ?? held;
				const [dead] = await db
					.insert(deploymentDeadLetterJobs)
					.values({
						originalJobId: failedRow.id,
						idempotencyKey: failedRow.idempotencyKey,
						type: failedRow.type,
						payload: failedRow.payload,
						reason: input.retryable ? "max_attempts_exceeded" : "non_retryable_error",
						attempts: failedRow.attempts,
						maxAttempts: failedRow.maxAttempts,
						lastError: input.error,
						movedBy: input.workerId,
						metadata: failedRow.metadata,
					})
					.returning();
				return { job: toQueueJob(failedRow), movedToDeadLetter: true, deadLetterJob: dead === undefined ? null : toDeadLetter(dead) };
			}),
		);

	const cancel: DeploymentQueueRepositoryShape["cancel"] = (jobId, reason) =>
		use(async (db) => {
			const now = new Date();
			const [row] = await db
				.update(deploymentQueueJobs)
				.set({
					status: "cancelled",
					lastError: reason,
					completedAt: now,
					lockToken: null,
					leaseExpiresAt: null,
					updatedAt: now,
				})
				.where(and(eq(deploymentQueueJobs.id, jobId), inArray(deploymentQueueJobs.status, [...LIVE_STATUSES])))
				.returning();
			return row === undefined ? null : toQueueJob(row);
		});

	const reapExpiredLeases: DeploymentQueueRepositoryShape["reapExpiredLeases"] = (now = new Date()) =>
		use(async (db) => {
			const rows = await db
				.update(deploymentQueueJobs)
				.set({
					status: "queued",
					workerId: null,
					lockToken: null,
					leaseExpiresAt: null,
					lastHeartbeatAt: null,
					availableAt: new Date(now.getTime() + REAPED_AVAILABLE_DELAY_MS),
					updatedAt: now,
				})
				.where(and(inArray(deploymentQueueJobs.status, [...HELD_STATUSES]), lte(deploymentQueueJobs.leaseExpiresAt, now)))
				.returning();
			return rows.map(toQueueJob);
		});

	const findById: DeploymentQueueRepositoryShape["findById"] = (jobId) =>
		use(async (db) => {
			const [row] = await db.select().from(deploymentQueueJobs).where(eq(deploymentQueueJobs.id, jobId)).limit(1);
			return row === undefined ? null : toQueueJob(row);
		});

	const list: DeploymentQueueRepositoryShape["list"] = (filters) =>
		use(async (db) => {
			const conditions: SQL[] = [];
			if (filters.type !== undefined) conditions.push(eq(deploymentQueueJobs.type, filters.type));
			if (filters.status !== undefined) conditions.push(eq(deploymentQueueJobs.status, filters.status));
			if (filters.workerId !== undefined) conditions.push(eq(deploymentQueueJobs.workerId, filters.workerId));
			if (filters.deploymentId !== undefined) conditions.push(eq(deploymentQueueJobs.deploymentId, filters.deploymentId));
			if (filters.serviceId !== undefined) conditions.push(sql`${deploymentQueueJobs.payload}->>'serviceId' = ${filters.serviceId}`);
			if (filters.projectId !== undefined) conditions.push(sql`${deploymentQueueJobs.payload}->>'projectId' = ${filters.projectId}`);
			const where = conditions.length === 0 ? undefined : and(...conditions);
			const [rows, totals] = await Promise.all([
				db.select().from(deploymentQueueJobs).where(where).orderBy(desc(deploymentQueueJobs.createdAt)).limit(filters.limit).offset(filters.offset),
				db.select({ value: count() }).from(deploymentQueueJobs).where(where),
			]);
			return { items: rows.map(toQueueJob), total: totals[0]?.value ?? 0 };
		});

	const hasLiveJobForDeployment: DeploymentQueueRepositoryShape["hasLiveJobForDeployment"] = (deploymentId) =>
		use(async (db) => {
			const [row] = await db
				.select({ id: deploymentQueueJobs.id })
				.from(deploymentQueueJobs)
				.where(and(eq(deploymentQueueJobs.deploymentId, deploymentId), inArray(deploymentQueueJobs.status, [...LIVE_STATUSES])))
				.limit(1);
			return row !== undefined;
		});

	const liveJobsForDeployment: DeploymentQueueRepositoryShape["liveJobsForDeployment"] = (deploymentId) =>
		use(async (db) => {
			const rows = await db
				.select()
				.from(deploymentQueueJobs)
				.where(and(eq(deploymentQueueJobs.deploymentId, deploymentId), inArray(deploymentQueueJobs.status, [...LIVE_STATUSES])));
			return rows.map(toQueueJob);
		});

	const listDeadLetters: DeploymentQueueRepositoryShape["listDeadLetters"] = (input) =>
		use(async (db) => {
			const conditions: SQL[] = [];
			if (input.type !== undefined) conditions.push(eq(deploymentDeadLetterJobs.type, input.type));
			if (input.reason !== undefined) conditions.push(eq(deploymentDeadLetterJobs.reason, input.reason));
			if (input.from !== undefined) conditions.push(gte(deploymentDeadLetterJobs.movedAt, new Date(input.from)));
			if (input.to !== undefined) conditions.push(lte(deploymentDeadLetterJobs.movedAt, new Date(input.to)));
			const where = conditions.length === 0 ? undefined : and(...conditions);
			const [rows, totals] = await Promise.all([
				db.select().from(deploymentDeadLetterJobs).where(where).orderBy(desc(deploymentDeadLetterJobs.movedAt)).limit(input.limit).offset(input.offset),
				db.select({ value: count() }).from(deploymentDeadLetterJobs).where(where),
			]);
			return { items: rows.map(toDeadLetter), total: totals[0]?.value ?? 0 };
		});

	const findDeadLetter: DeploymentQueueRepositoryShape["findDeadLetter"] = (id) =>
		use(async (db) => {
			const [row] = await db.select().from(deploymentDeadLetterJobs).where(eq(deploymentDeadLetterJobs.id, id)).limit(1);
			return row === undefined ? null : toDeadLetter(row);
		});

	const replayDeadLetter: DeploymentQueueRepositoryShape["replayDeadLetter"] = (id, replay) =>
		transaction(
			use(async (db) => {
				const [dead] = await db.select().from(deploymentDeadLetterJobs).where(eq(deploymentDeadLetterJobs.id, id)).for("update");
				if (dead === undefined) return null;
				const [created] = await db
					.insert(deploymentQueueJobs)
					.values({
						type: dead.type,
						idempotencyKey: `${dead.idempotencyKey}:replay:${String(dead.replayCount + 1)}`,
						payload: replay.payload,
						deploymentId: replay.payload.deploymentId ?? null,
						maxAttempts: dead.maxAttempts,
						...(replay.availableAt === undefined ? {} : { availableAt: new Date(replay.availableAt) }),
						metadata: replay.metadata,
					})
					.returning();
				const [updated] = await db
					.update(deploymentDeadLetterJobs)
					.set({ replayCount: dead.replayCount + 1, lastReplayAt: new Date() })
					.where(eq(deploymentDeadLetterJobs.id, id))
					.returning();
				if (created === undefined || updated === undefined) throw new Error("dead-letter replay wrote no row");
				return { job: toQueueJob(created), deadLetter: toDeadLetter(updated) };
			}),
		);

	return {
		enqueue,
		claim,
		claimByIdempotencyKey,
		heartbeat,
		complete,
		fail,
		cancel,
		reapExpiredLeases,
		findById,
		list,
		hasLiveJobForDeployment,
		liveJobsForDeployment,
		listDeadLetters,
		findDeadLetter,
		replayDeadLetter,
	};
}
