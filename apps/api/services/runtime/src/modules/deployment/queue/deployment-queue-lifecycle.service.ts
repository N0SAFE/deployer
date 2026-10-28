import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Subject } from "rxjs";
import type { Observable } from "rxjs";
import { runPromiseUnwrapped } from "@deployer/effect-core";
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
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";
import { MeshQueueTransitionService } from "@deployer/shared/core/modules/mesh/services/mesh-queue-transition.service";

import { makeRuntimeDb } from "../../../core/database/runtime-db";
import { RuntimeNotFound } from "../../../core/runtime.errors";
import { DeploymentQueueEventService } from "./deployment-queue-event.service";
import {
    makeDeploymentQueueRepository,
    type DeploymentQueueRepositoryShape,
    type QueueListFilters,
} from "./repositories/deployment-queue.repository";

/** DI token for substituting the repository (specs only). */
export const DEPLOYMENT_QUEUE_REPOSITORY = Symbol("DEPLOYMENT_QUEUE_REPOSITORY");

type QueueListOutput = {
    items: DeploymentQueueJob[];
    total: number;
    hasMore: boolean;
};

/**
 * The deployment queue's lifecycle, over the durable `deployment_queue_jobs` table.
 *
 * Every transition is a guarded database write (`DeploymentQueueRepository`): claims use `FOR UPDATE SKIP
 * LOCKED`, and a worker that lost its lease can no longer heartbeat, complete or fail the job. What stays
 * here is what is not storage: the typed events, the best-effort mesh replication, and the RxJS
 * `onJobQueued` channel the worker subscribes to. Jobs survive a restart: a sweep at boot and then on a
 * cadence returns expired leases to the pool and re-announces every job that is claimable.
 */
@Injectable()
export class DeploymentQueueLifecycleService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(DeploymentQueueLifecycleService.name);

    /** Interval (ms) between lease reaps and claimable-job announcements. */
    private static readonly SWEEP_INTERVAL_MS = 15_000;
    /** How many claimable jobs one sweep announces. */
    private static readonly SWEEP_BATCH = 100;

    private readonly retryTimers = new Map<string, NodeJS.Timeout>();
    private sweepTimer: NodeJS.Timeout | null = null;
    private repository: DeploymentQueueRepositoryShape | undefined;

    /**
     * Typed job-queued channel: every newly claimable job is emitted here as the typed Zod shape, the single
     * source the worker subscribes to. A deduplicated enqueue does NOT re-emit.
     */
    private readonly jobQueued$ = new Subject<DeploymentQueueJob>();

    constructor(
        private readonly databaseService: GlobalDatabaseService,
        private readonly deploymentQueueEventService: DeploymentQueueEventService,
        @Optional() private readonly meshQueueTransitionService?: MeshQueueTransitionService,
        /** Unit specs inject an in-memory repository; the app builds the Postgres one lazily. */
        @Optional() @Inject(DEPLOYMENT_QUEUE_REPOSITORY) repository?: DeploymentQueueRepositoryShape,
    ) {
        this.repository = repository;
    }

    private get queue(): DeploymentQueueRepositoryShape {
        this.repository ??= makeDeploymentQueueRepository(makeRuntimeDb(this.databaseService));
        return this.repository;
    }

    onModuleInit(): void {
        // Boot reconcile and the steady-state sweep are the same pass: release abandoned leases, then announce
        // what is claimable (including jobs enqueued before a restart).
        void this.sweep();
        this.sweepTimer = setInterval(() => void this.sweep(), DeploymentQueueLifecycleService.SWEEP_INTERVAL_MS);
    }

    onModuleDestroy(): void {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
        }
        for (const [, timer] of this.retryTimers) clearTimeout(timer);
        this.retryTimers.clear();
    }

    /** Observable of newly-claimable typed jobs. */
    onJobQueued(): Observable<DeploymentQueueJob> {
        return this.jobQueued$.asObservable();
    }

    /** One reap and announce pass. Never throws: a database blip is retried on the next tick. */
    async sweep(): Promise<void> {
        try {
            await this.reapExpiredLeases();
            const claimable = await runPromiseUnwrapped(
                this.queue.list({ status: "queued", limit: DeploymentQueueLifecycleService.SWEEP_BATCH, offset: 0 }),
            );
            const now = Date.now();
            for (const job of claimable.items) {
                if (new Date(job.availableAt).getTime() <= now) this.jobQueued$.next(job);
            }
        } catch (error) {
            this.logger.warn(`Queue sweep failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async hasLiveJobForDeployment(deploymentId: string): Promise<boolean> {
        return runPromiseUnwrapped(this.queue.hasLiveJobForDeployment(deploymentId));
    }

    async enqueueQueueJob(input: DeploymentQueueEnqueueInput): Promise<DeploymentQueueEnqueueResult> {
        const { job, deduplicated } = await runPromiseUnwrapped(this.queue.enqueue(input));
        if (deduplicated) return { enqueued: true, deduplicated: true, job };

        this.jobQueued$.next(job);
        this.deploymentQueueEventService.emit(
            "jobEnqueued",
            { queue: "deployment" },
            { ...this.eventFields(job), deduplicated: false, job, timestamp: job.updatedAt },
        );
        this.replicate(job, null, `${job.id}:queued:${job.updatedAt}`);
        return { enqueued: true, deduplicated: false, job };
    }

    async claimQueueJobs(input: DeploymentQueueClaimInput): Promise<DeploymentQueueClaimResult> {
        const claimed = await runPromiseUnwrapped(this.queue.claim(input));
        for (const job of claimed) this.announceClaim(job);
        return { claimed };
    }

    async claimQueueJobByIdempotencyKey(
        idempotencyKey: string,
        input: DeploymentQueueClaimInput,
    ): Promise<DeploymentQueueJob | null> {
        const job = await runPromiseUnwrapped(this.queue.claimByIdempotencyKey(idempotencyKey, input));
        if (job !== null) this.announceClaim(job);
        return job;
    }

    async heartbeatQueueJob(
        jobId: string,
        input: DeploymentQueueHeartbeatInput,
    ): Promise<DeploymentQueueHeartbeatResult | null> {
        const job = await runPromiseUnwrapped(this.queue.heartbeat(jobId, input));
        if (job === null) return null;

        this.deploymentQueueEventService.emit(
            "jobHeartbeat",
            { queue: "deployment" },
            { ...this.eventFields(job), leaseExpiresAt: job.leaseExpiresAt, timestamp: job.updatedAt },
        );
        this.replicate(job, "running", `${job.id}:running:${job.updatedAt}`);

        return {
            acknowledged: true,
            leaseExpiresAt: job.leaseExpiresAt,
            lastHeartbeatAt: job.lastHeartbeatAt,
            observedConnectivityStatus: job.connectivityStatus,
            observedAt: new Date().toISOString(),
        };
    }

    async completeQueueJob(
        jobId: string,
        workerId: string,
        lockToken: string,
        result: Record<string, unknown> | undefined,
    ): Promise<DeploymentQueueTransitionResult | null> {
        const job = await runPromiseUnwrapped(this.queue.complete(jobId, workerId, lockToken, result));
        if (job === null) return null;

        this.deploymentQueueEventService.emit(
            "jobCompleted",
            { queue: "deployment" },
            { ...this.eventFields(job), job, timestamp: job.updatedAt },
        );
        this.replicate(job, "running", `${job.id}:succeeded:${job.updatedAt}`);
        return { updated: true, job };
    }

    async failQueueJob(
        jobId: string,
        input: DeploymentQueueFailInput,
    ): Promise<{ transition: DeploymentQueueTransitionResult; failedJob: DeploymentQueueJob; movedToDeadLetter: boolean } | null> {
        const outcome = await runPromiseUnwrapped(this.queue.fail(jobId, input));
        if (outcome === null) return null;
        const { job, movedToDeadLetter, deadLetterJob } = outcome;

        this.deploymentQueueEventService.emit(
            "jobFailed",
            { queue: "deployment" },
            {
                ...this.eventFields(job),
                error: input.error,
                movedToDeadLetter,
                job,
                deadLetterJob,
                timestamp: job.updatedAt,
            },
        );
        this.replicate(job, "running", `${job.id}:${movedToDeadLetter ? "failed" : "retry-queued"}:${job.updatedAt}`);
        if (!movedToDeadLetter) this.scheduleRetryReEmit(job);

        return { transition: { updated: true, job }, failedJob: job, movedToDeadLetter };
    }

    /** Cancels a job that has not finished. Null when it is unknown or already terminal. */
    async cancelQueueJob(jobId: string, reason: string): Promise<DeploymentQueueJob | null> {
        const job = await runPromiseUnwrapped(this.queue.cancel(jobId, reason));
        if (job === null) return null;
        this.clearRetryTimer(job.id);
        this.replicate(job, "running", `${job.id}:cancelled:${job.updatedAt}`);
        return job;
    }

    async findQueueJobById(jobId: string): Promise<DeploymentQueueJob | null> {
        return runPromiseUnwrapped(this.queue.findById(jobId));
    }

    async listQueueJobs(input: QueueListFilters): Promise<QueueListOutput> {
        const page = await runPromiseUnwrapped(this.queue.list(input));
        return { items: page.items, total: page.total, hasMore: input.offset + page.items.length < page.total };
    }

    async listDeadLetterJobs(input: DeploymentDeadLetterListInput): Promise<DeploymentDeadLetterListResult> {
        const page = await runPromiseUnwrapped(this.queue.listDeadLetters(input));
        return { items: page.items, total: page.total, hasMore: input.offset + page.items.length < page.total };
    }

    async findDeadLetterJobById(deadLetterJobId: string): Promise<DeploymentDeadLetterJob | null> {
        return runPromiseUnwrapped(this.queue.findDeadLetter(deadLetterJobId));
    }

    async replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): Promise<DeploymentDeadLetterReplayResult> {
        const item = await runPromiseUnwrapped(this.queue.findDeadLetter(input.deadLetterJobId));
        if (item === null) {
            throw new RuntimeNotFound({ reason: `Dead-letter job '${input.deadLetterJobId}' not found` });
        }

        const payload = input.replayMode === "patched_payload" ? { ...item.payload, ...(input.payloadPatch ?? {}) } : item.payload;
        const replayed = await runPromiseUnwrapped(
            this.queue.replayDeadLetter(item.id, {
                payload,
                availableAt: input.scheduledAt,
                metadata: {
                    deadLetterJobId: item.id,
                    replayMode: input.replayMode,
                    reason: input.reason,
                    requestedBy: input.requestedBy,
                },
            }),
        );
        if (replayed === null) {
            throw new RuntimeNotFound({ reason: `Dead-letter job '${input.deadLetterJobId}' not found` });
        }

        this.jobQueued$.next(replayed.job);
        this.deploymentQueueEventService.emit(
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
            replayed: true,
            deadLetterJobId: item.id,
            replayJobId: replayed.job.id,
            replayCount: replayed.deadLetter.replayCount,
            message: "Dead-letter job replayed successfully",
        };
    }

    /**
     * Returns claims whose lease expired (the worker died without heartbeating) to the claimable pool.
     * `attempts` are untouched: an interrupted execution is not a failure.
     */
    async reapExpiredLeases(now: Date = new Date()): Promise<number> {
        const released = await runPromiseUnwrapped(this.queue.reapExpiredLeases(now));
        for (const job of released) {
            this.deploymentQueueEventService.emit(
                "jobFailed",
                { queue: "deployment" },
                {
                    ...this.eventFields(job),
                    error: "Execution lease expired — worker lost; job released for re-execution",
                    movedToDeadLetter: false,
                    job,
                    deadLetterJob: null,
                    timestamp: job.updatedAt,
                },
            );
            this.replicate(job, "running", `${job.id}:lease-released:${job.updatedAt}`);
            this.scheduleRetryReEmit(job);
        }
        return released.length;
    }

    private announceClaim(job: DeploymentQueueJob): void {
        this.deploymentQueueEventService.emit(
            "jobClaimed",
            { queue: "deployment" },
            { ...this.eventFields(job), claimedCount: 1, job, timestamp: job.updatedAt },
        );
        this.replicate(job, "queued", `${job.id}:claimed:${job.updatedAt}`);
    }

    private eventFields(job: DeploymentQueueJob) {
        return {
            jobId: job.id,
            workerId: job.workerId,
            jobType: job.type,
            status: job.status,
            deploymentId: job.payload.deploymentId,
            serviceId: job.payload.serviceId,
            projectId: job.payload.projectId,
        };
    }

    private clearRetryTimer(jobId: string): void {
        const existing = this.retryTimers.get(jobId);
        if (existing) {
            clearTimeout(existing);
            this.retryTimers.delete(jobId);
        }
    }

    /** Re-announces a re-queued job at the moment it becomes claimable (the sweep covers a restart). */
    private scheduleRetryReEmit(retryJob: DeploymentQueueJob): void {
        this.clearRetryTimer(retryJob.id);
        const delayMs = Math.max(0, new Date(retryJob.availableAt).getTime() - Date.now());
        const timer = setTimeout(() => {
            this.retryTimers.delete(retryJob.id);
            void this.findQueueJobById(retryJob.id)
                .then((current) => {
                    if (current?.status === "queued" && current.attempts === retryJob.attempts) this.jobQueued$.next(current);
                })
                .catch(() => undefined);
        }, delayMs);
        this.retryTimers.set(retryJob.id, timer);
    }

    private replicate(job: DeploymentQueueJob, fromStatus: string | null, idempotencyKey: string): void {
        if (!this.meshQueueTransitionService) return;

        const partitionKey = job.payload.deploymentId ? `deployment:${job.payload.deploymentId}` : `job:${job.id}`;
        void this.meshQueueTransitionService
            .appendAndReplicate({
                queue: "deployment",
                partitionKey,
                jobId: job.id,
                fromStatus,
                toStatus: job.status,
                workerId: job.workerId,
                idempotencyKey,
                occurredAt: job.updatedAt,
                metadata: {
                    serviceId: job.payload.serviceId,
                    projectId: job.payload.projectId,
                    deploymentId: job.payload.deploymentId,
                    jobType: job.type,
                    attempts: job.attempts,
                },
            })
            .catch(() => {
                // Best-effort mesh replication must not block queue lifecycle progression.
            });
    }
}
