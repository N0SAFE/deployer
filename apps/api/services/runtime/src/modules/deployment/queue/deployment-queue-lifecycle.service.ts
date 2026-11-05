import { Cause, Context, Effect, Fiber, Schedule } from "effect";
import { Subject } from "rxjs";

import type {
    DeploymentDeadLetterJob,
    DeploymentDeadLetterListInput,
    DeploymentDeadLetterListResult,
    DeploymentDeadLetterReplayInput,
    DeploymentDeadLetterReplayResult,
    DeploymentQueueClaimInput,
    DeploymentQueueClaimResult,
    DeploymentQueueEnqueueInput,
    DeploymentQueueEnqueueResult,
    DeploymentQueueFailInput,
    DeploymentQueueHeartbeatInput,
    DeploymentQueueHeartbeatResult,
    DeploymentQueueJob,
    DeploymentQueueTransitionResult,
} from "@deployer/contracts-entities";
import type { DbError } from "@deployer/effect-infra";
import type { ServiceLifecycleShape } from "@deployer/nest-effect";

import { RuntimeNotFound } from "../../../core/runtime.errors";

import type { DeploymentQueueEventService } from "./deployment-queue-event.service";
import type { DeploymentQueueRepositoryShape, QueueListFilters } from "./repositories/deployment-queue.repository";
import type { Observable } from "rxjs";

type QueueListOutput = {
    items: DeploymentQueueJob[];
    total: number;
    hasMore: boolean;
};

/** Interval between lease reaps and claimable-job announcements. */
const SWEEP_INTERVAL = "15 seconds";
/** How many claimable jobs one sweep announces. */
const SWEEP_BATCH = 100;

/**
 * The deployment queue's lifecycle, over the durable `deployment_queue_jobs` table.
 *
 * Every transition is a guarded database write (`DeploymentQueueRepository`): claims use `FOR UPDATE SKIP
 * LOCKED`, and a worker that lost its lease can no longer heartbeat, complete or fail the job. What stays
 * here is what is not storage: the typed events, the best-effort mesh replication, and the RxJS
 * `jobQueued$` channel the worker subscribes to. Jobs survive a restart: a sweep at boot and then on a
 * cadence (`run`) returns expired leases to the pool and re-announces every job that is claimable.
 *
 * A method fails with `DbError` when the table refuses, and with `RuntimeNotFound` when a dead letter is unknown.
 */
export type DeploymentQueueLifecycleShape = ServiceLifecycleShape & {
    /**
     * Every newly claimable job, as the typed Zod shape: the single source the worker subscribes to. A
     * deduplicated enqueue does NOT re-emit.
     */
    readonly jobQueued$: Observable<DeploymentQueueJob>;
    /** Jobs that were cancelled; the worker subscribes to stop the one it is executing. */
    readonly jobCancelled$: Observable<DeploymentQueueJob>;
    /** One reap and announce pass. Never fails: a database blip is retried on the next tick. */
    readonly sweep: () => Effect.Effect<void>;
    readonly hasLiveJobForDeployment: (deploymentId: string) => Effect.Effect<boolean, DbError>;
    readonly enqueueQueueJob: (input: DeploymentQueueEnqueueInput) => Effect.Effect<DeploymentQueueEnqueueResult, DbError>;
    readonly claimQueueJobs: (input: DeploymentQueueClaimInput) => Effect.Effect<DeploymentQueueClaimResult, DbError>;
    readonly claimQueueJobByIdempotencyKey: (
        idempotencyKey: string,
        input: DeploymentQueueClaimInput,
    ) => Effect.Effect<DeploymentQueueJob | null, DbError>;
    readonly heartbeatQueueJob: (
        jobId: string,
        input: DeploymentQueueHeartbeatInput,
    ) => Effect.Effect<DeploymentQueueHeartbeatResult | null, DbError>;
    readonly completeQueueJob: (
        jobId: string,
        workerId: string,
        lockToken: string,
        result: Record<string, unknown> | undefined,
    ) => Effect.Effect<DeploymentQueueTransitionResult | null, DbError>;
    readonly failQueueJob: (
        jobId: string,
        input: DeploymentQueueFailInput,
    ) => Effect.Effect<
        { transition: DeploymentQueueTransitionResult; failedJob: DeploymentQueueJob; movedToDeadLetter: boolean } | null,
        DbError
    >;
    /** Cancels a job that has not finished. Null when it is unknown or already terminal. */
    readonly cancelQueueJob: (jobId: string, reason: string) => Effect.Effect<DeploymentQueueJob | null, DbError>;
    /** Cancels every live job of a deployment; the worker stops whichever one is executing. */
    readonly cancelJobsForDeployment: (deploymentId: string, reason: string) => Effect.Effect<DeploymentQueueJob[], DbError>;
    readonly findQueueJobById: (jobId: string) => Effect.Effect<DeploymentQueueJob | null, DbError>;
    readonly listQueueJobs: (input: QueueListFilters) => Effect.Effect<QueueListOutput, DbError>;
    readonly listDeadLetterJobs: (input: DeploymentDeadLetterListInput) => Effect.Effect<DeploymentDeadLetterListResult, DbError>;
    readonly findDeadLetterJobById: (deadLetterJobId: string) => Effect.Effect<DeploymentDeadLetterJob | null, DbError>;
    readonly replayDeadLetterJob: (
        input: DeploymentDeadLetterReplayInput,
    ) => Effect.Effect<DeploymentDeadLetterReplayResult, DbError | RuntimeNotFound>;
    /**
     * Returns claims whose lease expired (the worker died without heartbeating) to the claimable pool.
     * `attempts` are untouched: an interrupted execution is not a failure.
     */
    readonly reapExpiredLeases: (now?: Date) => Effect.Effect<number, DbError>;
};

export class DeploymentQueueLifecycle extends Context.Service<DeploymentQueueLifecycle, DeploymentQueueLifecycleShape>()(
    "runtime/DeploymentQueueLifecycle",
) {}

export type DeploymentQueueLifecyclePorts = {
    /** The durable store; specs hand in the in-memory one. */
    readonly repository: DeploymentQueueRepositoryShape;
    /** The typed event bus the transitions are announced on. */
    readonly events: Pick<DeploymentQueueEventService, "emit">;
};

/** Builds the lifecycle over its ports; the Rx channels and the retry fibers live in this closure. */
export function makeDeploymentQueueLifecycle({ repository: queue, events }: DeploymentQueueLifecyclePorts): DeploymentQueueLifecycleShape {
    const jobQueued$ = new Subject<DeploymentQueueJob>();
    const jobCancelled$ = new Subject<DeploymentQueueJob>();
    /** One fiber per re-queued job, waiting for the moment it becomes claimable again. */
    const retryFibers = new Map<string, Fiber.Fiber<void>>();

    const eventFields = (job: DeploymentQueueJob) => ({
        jobId: job.id,
        workerId: job.workerId,
        jobType: job.type,
        status: job.status,
        deploymentId: job.payload.deploymentId,
        serviceId: job.payload.serviceId,
        projectId: job.payload.projectId,
    });

    const announceClaim = (job: DeploymentQueueJob) =>
        Effect.sync(() =>
            events.emit(
                "jobClaimed",
                { queue: "deployment" },
                { ...eventFields(job), claimedCount: 1, job, timestamp: job.updatedAt },
            ),
        );

    const clearRetry = (jobId: string) =>
        Effect.suspend(() => {
            const existing = retryFibers.get(jobId);
            retryFibers.delete(jobId);
            return existing ? Fiber.interrupt(existing) : Effect.void;
        });

    const findQueueJobById: DeploymentQueueLifecycleShape["findQueueJobById"] = (jobId) => queue.findById(jobId);

    /** Re-announces a re-queued job at the moment it becomes claimable (the sweep covers a restart). */
    const scheduleRetryReEmit = (retryJob: DeploymentQueueJob) =>
        Effect.gen(function* () {
            yield* clearRetry(retryJob.id);
            const delayMs = Math.max(0, new Date(retryJob.availableAt).getTime() - Date.now());
            const fiber = yield* Effect.sleep(delayMs).pipe(
                Effect.andThen(findQueueJobById(retryJob.id)),
                Effect.tap((current) =>
                    Effect.sync(() => {
                        if (current?.status === "queued" && current.attempts === retryJob.attempts) jobQueued$.next(current);
                    }),
                ),
                Effect.ignore,
                Effect.forkDetach,
            );
            retryFibers.set(retryJob.id, fiber);
            fiber.addObserver(() => {
                if (retryFibers.get(retryJob.id) === fiber) retryFibers.delete(retryJob.id);
            });
        });

    const reapExpiredLeases: DeploymentQueueLifecycleShape["reapExpiredLeases"] = (now = new Date()) =>
        Effect.gen(function* () {
            const released = yield* queue.reapExpiredLeases(now);
            for (const job of released) {
                events.emit(
                    "jobFailed",
                    { queue: "deployment" },
                    {
                        ...eventFields(job),
                        error: "Execution lease expired — worker lost; job released for re-execution",
                        movedToDeadLetter: false,
                        job,
                        deadLetterJob: null,
                        timestamp: job.updatedAt,
                    },
                );
                yield* scheduleRetryReEmit(job);
            }
            return released.length;
        });

    const sweep: DeploymentQueueLifecycleShape["sweep"] = () =>
        Effect.gen(function* () {
            yield* reapExpiredLeases();
            const claimable = yield* queue.list({ status: "queued", limit: SWEEP_BATCH, offset: 0 });
            const now = Date.now();
            for (const job of claimable.items) {
                if (new Date(job.availableAt).getTime() <= now) jobQueued$.next(job);
            }
        }).pipe(
            Effect.catchCause((cause) => Effect.logWarning(`Queue sweep failed: ${Cause.pretty(cause)}`)),
        );

    const cancelQueueJob: DeploymentQueueLifecycleShape["cancelQueueJob"] = (jobId, reason) =>
        Effect.gen(function* () {
            const job = yield* queue.cancel(jobId, reason);
            if (job === null) return null;
            yield* clearRetry(job.id);
            jobCancelled$.next(job);
            return job;
        });

    return {
        jobQueued$: jobQueued$.asObservable(),
        jobCancelled$: jobCancelled$.asObservable(),

        // Boot reconcile and the steady-state sweep are the same pass: release abandoned leases, then announce
        // what is claimable (including jobs enqueued before a restart).
        run: () => sweep().pipe(Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)), Effect.asVoid),
        onStop: () =>
            Effect.suspend(() => {
                const pending = [...retryFibers.values()];
                retryFibers.clear();
                return Fiber.interruptAll(pending);
            }),

        sweep,
        hasLiveJobForDeployment: (deploymentId) => queue.hasLiveJobForDeployment(deploymentId),

        enqueueQueueJob: (input) =>
            Effect.gen(function* () {
                const { job, deduplicated } = yield* queue.enqueue(input);
                if (deduplicated) return { enqueued: true, deduplicated: true, job };

                jobQueued$.next(job);
                events.emit(
                    "jobEnqueued",
                    { queue: "deployment" },
                    { ...eventFields(job), deduplicated: false, job, timestamp: job.updatedAt },
                );
                return { enqueued: true, deduplicated: false, job };
            }),

        claimQueueJobs: (input) =>
            Effect.gen(function* () {
                const claimed = yield* queue.claim(input);
                for (const job of claimed) yield* announceClaim(job);
                return { claimed };
            }),

        claimQueueJobByIdempotencyKey: (idempotencyKey, input) =>
            Effect.gen(function* () {
                const job = yield* queue.claimByIdempotencyKey(idempotencyKey, input);
                if (job !== null) yield* announceClaim(job);
                return job;
            }),

        heartbeatQueueJob: (jobId, input) =>
            Effect.gen(function* () {
                const job = yield* queue.heartbeat(jobId, input);
                if (job === null) return null;

                events.emit(
                    "jobHeartbeat",
                    { queue: "deployment" },
                    { ...eventFields(job), leaseExpiresAt: job.leaseExpiresAt, timestamp: job.updatedAt },
                );

                return {
                    acknowledged: true as const,
                    leaseExpiresAt: job.leaseExpiresAt,
                    lastHeartbeatAt: job.lastHeartbeatAt,
                    observedConnectivityStatus: job.connectivityStatus,
                    observedAt: new Date().toISOString(),
                };
            }),

        completeQueueJob: (jobId, workerId, lockToken, result) =>
            Effect.gen(function* () {
                const job = yield* queue.complete(jobId, workerId, lockToken, result);
                if (job === null) return null;

                events.emit(
                    "jobCompleted",
                    { queue: "deployment" },
                    { ...eventFields(job), job, timestamp: job.updatedAt },
                );
                return { updated: true as const, job };
            }),

        failQueueJob: (jobId, input) =>
            Effect.gen(function* () {
                const outcome = yield* queue.fail(jobId, input);
                if (outcome === null) return null;
                const { job, movedToDeadLetter, deadLetterJob } = outcome;

                events.emit(
                    "jobFailed",
                    { queue: "deployment" },
                    {
                        ...eventFields(job),
                        error: input.error,
                        movedToDeadLetter,
                        job,
                        deadLetterJob,
                        timestamp: job.updatedAt,
                    },
                );
                if (!movedToDeadLetter) yield* scheduleRetryReEmit(job);

                return { transition: { updated: true as const, job }, failedJob: job, movedToDeadLetter };
            }),

        cancelQueueJob,

        cancelJobsForDeployment: (deploymentId, reason) =>
            Effect.gen(function* () {
                const live = yield* queue.liveJobsForDeployment(deploymentId);
                const cancelled: DeploymentQueueJob[] = [];
                for (const job of live) {
                    const result = yield* cancelQueueJob(job.id, reason);
                    if (result !== null) cancelled.push(result);
                }
                return cancelled;
            }),

        findQueueJobById,

        listQueueJobs: (input) =>
            Effect.map(queue.list(input), (page) => ({
                items: page.items,
                total: page.total,
                hasMore: input.offset + page.items.length < page.total,
            })),

        listDeadLetterJobs: (input) =>
            Effect.map(queue.listDeadLetters(input), (page) => ({
                items: page.items,
                total: page.total,
                hasMore: input.offset + page.items.length < page.total,
            })),

        findDeadLetterJobById: (deadLetterJobId) => queue.findDeadLetter(deadLetterJobId),

        replayDeadLetterJob: (input) =>
            Effect.gen(function* () {
                const item = yield* queue.findDeadLetter(input.deadLetterJobId);
                if (item === null) {
                    return yield* new RuntimeNotFound({ reason: `Dead-letter job '${input.deadLetterJobId}' not found` });
                }

                const payload =
                    input.replayMode === "patched_payload" ? { ...item.payload, ...(input.payloadPatch ?? {}) } : item.payload;
                const replayed = yield* queue.replayDeadLetter(item.id, {
                    payload,
                    availableAt: input.scheduledAt,
                    metadata: {
                        deadLetterJobId: item.id,
                        replayMode: input.replayMode,
                        reason: input.reason,
                        requestedBy: input.requestedBy,
                    },
                });
                if (replayed === null) {
                    return yield* new RuntimeNotFound({ reason: `Dead-letter job '${input.deadLetterJobId}' not found` });
                }

                jobQueued$.next(replayed.job);
                events.emit(
                    "deadLetterReplayed",
                    { queue: "deployment" },
                    {
                        queue: "deployment",
                        deadLetterJobId: item.id,
                        replayJobId: replayed.job.id,
                        replayCount: replayed.deadLetter.replayCount,
                        timestamp: replayed.deadLetter.lastReplayAt ?? new Date().toISOString(),
                    },
                );

                return {
                    replayed: true as const,
                    deadLetterJobId: item.id,
                    replayJobId: replayed.job.id,
                    replayCount: replayed.deadLetter.replayCount,
                    message: "Dead-letter job replayed successfully",
                };
            }),

        reapExpiredLeases,
    };
}
