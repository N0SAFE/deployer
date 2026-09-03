import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Subject } from "rxjs";
import type { Observable } from "rxjs";
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
} from "@repo/contracts-entities";
import { MeshQueueTransitionService } from "@/core/modules/mesh/services/mesh-queue-transition.service";
import { DeploymentQueueEventService } from "./deployment-queue-event.service";

interface QueueListFilters {
    type?: DeploymentQueueJob["type"];
    status?: DeploymentQueueJob["status"];
    workerId?: string;
    deploymentId?: string;
    serviceId?: string;
    projectId?: string;
    limit: number;
    offset: number;
}

interface QueueListOutput {
    items: DeploymentQueueJob[];
    total: number;
    hasMore: boolean;
}

@Injectable()
export class DeploymentQueueLifecycleService implements OnModuleInit, OnModuleDestroy {
    private readonly queueJobs = new Map<string, DeploymentQueueJob>();
    private readonly deadLetterJobs = new Map<string, DeploymentDeadLetterJob>();

    /** Interval (ms) between abandoned-lease sweeps (W-Queue Q2). */
    private static readonly LEASE_REAP_INTERVAL_MS = 30_000;
    /** Delay before a reclaimed job can be claimed again (avoids hot re-claim). */
    private static readonly REAPED_AVAILABLE_DELAY_MS = 1_000;

    /**
     * Pending retry re-emit timers (W-Queue, Q1 fix). The retry branch puts a
     * job back to `queued` with a future `availableAt`; the worker drains on the
     * `jobQueued$` channel and claim requires `availableAt <= now`, so the re-emit
     * is DEFERRED to exactly `availableAt` instead of firing immediately (which
     * would be skipped as "stale"). Timers are tracked for cleanup on destroy.
     */
    private readonly retryTimers = new Map<string, NodeJS.Timeout>();
    private leaseReapTimer: NodeJS.Timeout | null = null;

    onModuleInit(): void {
        // W-Queue (Q2): periodically return abandoned claims (worker died with an
        // unextended lease) to the claimable pool. The queue is in-process, so this
        // sweep is the single authority for lease recovery.
        this.leaseReapTimer = setInterval(
            () => this.reapExpiredLeases(),
            DeploymentQueueLifecycleService.LEASE_REAP_INTERVAL_MS,
        );
    }

    /**
     * Typed job-queued channel (D-6): every NEWLY enqueued job is emitted
     * here as the typed Zod shape — the SINGLE source of truth the worker
     * subscribes to. Deduplicated enqueues do NOT re-emit. Mirrors the
     * typed-observable pattern of the core events module (no external queue
     * IO — everything stays in-process + typed).
     */
    private readonly jobQueued$ = new Subject<DeploymentQueueJob>();

    constructor(
        private readonly deploymentQueueEventService: DeploymentQueueEventService,
        @Optional() private readonly meshQueueTransitionService?: MeshQueueTransitionService,
    ) {}

    getQueueJobsStore(): Map<string, DeploymentQueueJob> {
        return this.queueJobs;
    }

    getDeadLetterJobsStore(): Map<string, DeploymentDeadLetterJob> {
        return this.deadLetterJobs;
    }

    /** Observable of newly-enqueued typed jobs (see D-6). */
    onJobQueued(): Observable<DeploymentQueueJob> {
        return this.jobQueued$.asObservable();
    }

    /**
     * True if any non-terminal job exists for the given deployment — used by
     * startup reconciliation to avoid failing a deployment with a live job
     * (e.g. a sibling process or an in-progress execution).
     */
    hasLiveJobForDeployment(deploymentId: string): boolean {
        for (const job of this.queueJobs.values()) {
            if (job.payload.deploymentId !== deploymentId) {
                continue;
            }
            if (job.status === "queued" || job.status === "claimed" || job.status === "running") {
                return true;
            }
        }
        return false;
    }

    enqueueQueueJob(input: DeploymentQueueEnqueueInput): DeploymentQueueEnqueueResult {
        const existing = [...this.queueJobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
        if (existing) {
            return { enqueued: true, deduplicated: true, job: existing };
        }

        const now = new Date();
        const job: DeploymentQueueJob = {
            id: randomUUID(),
            type: input.type,
            status: "queued",
            idempotencyKey: input.idempotencyKey,
            workerId: null,
            lockToken: null,
            payload: input.payload,
            attempts: 0,
            maxAttempts: input.maxAttempts,
            availableAt: input.availableAt ?? now.toISOString(),
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            connectivityStatus: null,
            startedAt: null,
            completedAt: null,
            lastError: null,
            metadata: input.metadata ?? null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        };

        this.queueJobs.set(job.id, job);

        // D-6: emit the NEW job on the typed channel so the worker executes it.
        this.jobQueued$.next(job);

        this.deploymentQueueEventService.emit(
            "jobEnqueued",
            { queue: "deployment" },
            {
                jobId: job.id,
                workerId: job.workerId,
                jobType: job.type,
                status: job.status,
                deploymentId: job.payload.deploymentId,
                serviceId: job.payload.serviceId,
                projectId: job.payload.projectId,
                deduplicated: false,
                job,
                timestamp: job.updatedAt,
            },
        );

        this.replicateQueueTransition({
            job,
            fromStatus: null,
            toStatus: job.status,
            workerId: job.workerId,
            idempotencyKey: `${job.id}:queued:${job.updatedAt}`,
        });

        return { enqueued: true, deduplicated: false, job };
    }

    claimQueueJobs(input: DeploymentQueueClaimInput): DeploymentQueueClaimResult {
        const now = Date.now();
        const selected = [...this.queueJobs.values()]
            .filter((job) => this.canClaimQueueJob(job, input, now))
            .slice(0, input.limit)
            .map((job) => this.claimQueueJob(job, input, now));

        return { claimed: selected };
    }

    claimQueueJobByIdempotencyKey(
        idempotencyKey: string,
        input: DeploymentQueueClaimInput,
    ): DeploymentQueueJob | null {
        const now = Date.now();
        const existing = [...this.queueJobs.values()].find(
            (job) => job.idempotencyKey === idempotencyKey && this.canClaimQueueJob(job, input, now),
        );

        if (!existing) {
            return null;
        }

        return this.claimQueueJob(existing, input, now);
    }

    heartbeatQueueJob(
        jobId: string,
        input: DeploymentQueueHeartbeatInput,
    ): DeploymentQueueHeartbeatResult | null {
        const existing = this.queueJobs.get(jobId);
        if (existing?.workerId !== input.workerId || existing.lockToken !== input.lockToken) {
            return null;
        }

        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + input.extendLeaseSec * 1000).toISOString();
        const updated: DeploymentQueueJob = {
            ...existing,
            status: "running",
            lastHeartbeatAt: now.toISOString(),
            leaseExpiresAt,
            connectivityStatus: input.connectivityStatus ?? existing.connectivityStatus,
            updatedAt: now.toISOString(),
        };
        this.queueJobs.set(jobId, updated);

        this.deploymentQueueEventService.emit(
            "jobHeartbeat",
            { queue: "deployment" },
            {
                jobId: updated.id,
                workerId: updated.workerId,
                jobType: updated.type,
                status: updated.status,
                deploymentId: updated.payload.deploymentId,
                serviceId: updated.payload.serviceId,
                projectId: updated.payload.projectId,
                leaseExpiresAt,
                timestamp: updated.updatedAt,
            },
        );

        this.replicateQueueTransition({
            job: updated,
            fromStatus: existing.status,
            toStatus: updated.status,
            workerId: updated.workerId,
            idempotencyKey: `${updated.id}:running:${updated.updatedAt}`,
        });

        return {
            acknowledged: true,
            leaseExpiresAt,
            lastHeartbeatAt: updated.lastHeartbeatAt,
            observedConnectivityStatus: updated.connectivityStatus,
            observedAt: now.toISOString(),
        };
    }

    completeQueueJob(
        jobId: string,
        workerId: string,
        lockToken: string,
        result: Record<string, unknown> | undefined,
    ): DeploymentQueueTransitionResult | null {
        const existing = this.queueJobs.get(jobId);
        if (existing?.workerId !== workerId || existing.lockToken !== lockToken) {
            return null;
        }

        const updated: DeploymentQueueJob = {
            ...existing,
            status: "succeeded",
            completedAt: new Date().toISOString(),
            lockToken: null,
            metadata: result ? { ...(existing.metadata ?? {}), result } : existing.metadata,
            updatedAt: new Date().toISOString(),
        };
        this.queueJobs.set(jobId, updated);
        this.deploymentQueueEventService.emit(
            "jobCompleted",
            { queue: "deployment" },
            {
                jobId: updated.id,
                workerId: updated.workerId,
                jobType: updated.type,
                status: updated.status,
                deploymentId: updated.payload.deploymentId,
                serviceId: updated.payload.serviceId,
                projectId: updated.payload.projectId,
                job: updated,
                timestamp: updated.updatedAt,
            },
        );

        this.replicateQueueTransition({
            job: updated,
            fromStatus: existing.status,
            toStatus: updated.status,
            workerId: updated.workerId,
            idempotencyKey: `${updated.id}:succeeded:${updated.updatedAt}`,
        });

        return { updated: true, job: updated };
    }

    failQueueJob(
        jobId: string,
        input: DeploymentQueueFailInput,
    ): { transition: DeploymentQueueTransitionResult; failedJob: DeploymentQueueJob; movedToDeadLetter: boolean } | null {
        const existing = this.queueJobs.get(jobId);
        if (existing?.workerId !== input.workerId || existing.lockToken !== input.lockToken) {
            return null;
        }

        const attempts = existing.attempts + 1;
        const canRetry = input.retryable && attempts < existing.maxAttempts;
        const now = new Date();

        if (canRetry) {
            const retryAt = input.retryAt ?? new Date(now.getTime() + 5_000).toISOString();
            const retryJob: DeploymentQueueJob = {
                ...existing,
                status: "queued",
                attempts,
                availableAt: retryAt,
                lastError: input.error,
                lockToken: null,
                leaseExpiresAt: null,
                updatedAt: now.toISOString(),
            };
            this.queueJobs.set(jobId, retryJob);
            this.deploymentQueueEventService.emit(
                "jobFailed",
                { queue: "deployment" },
                {
                    jobId: retryJob.id,
                    workerId: retryJob.workerId,
                    jobType: retryJob.type,
                    status: retryJob.status,
                    deploymentId: retryJob.payload.deploymentId,
                    serviceId: retryJob.payload.serviceId,
                    projectId: retryJob.payload.projectId,
                    error: input.error,
                    movedToDeadLetter: false,
                    job: retryJob,
                    deadLetterJob: null,
                    timestamp: retryJob.updatedAt,
                },
            );

            this.replicateQueueTransition({
                job: retryJob,
                fromStatus: existing.status,
                toStatus: retryJob.status,
                workerId: retryJob.workerId,
                idempotencyKey: `${retryJob.id}:retry-queued:${retryJob.updatedAt}`,
            });

            // W-Queue (Q1): the retried job must RE-EXECUTE. Re-emit it on the
            // typed channel exactly when it becomes claimable (`availableAt`), so
            // the worker chain picks it up again — the same path a fresh enqueue
            // takes. Without this, retried jobs sat `queued` forever (no poller).
            this.scheduleRetryReEmit(retryJob);

            return {
                transition: { updated: true, job: retryJob },
                failedJob: retryJob,
                movedToDeadLetter: false,
            };
        }

        const failedJob: DeploymentQueueJob = {
            ...existing,
            status: "failed",
            attempts,
            lastError: input.error,
            completedAt: now.toISOString(),
            lockToken: null,
            leaseExpiresAt: null,
            updatedAt: now.toISOString(),
        };
        this.queueJobs.set(jobId, failedJob);

        const deadLetter: DeploymentDeadLetterJob = {
            id: randomUUID(),
            originalJobId: failedJob.id,
            idempotencyKey: failedJob.idempotencyKey,
            type: failedJob.type,
            payload: failedJob.payload,
            reason: input.retryable ? "max_attempts_exceeded" : "non_retryable_error",
            attempts: failedJob.attempts,
            maxAttempts: failedJob.maxAttempts,
            lastError: input.error,
            movedAt: now.toISOString(),
            movedBy: input.workerId,
            replayCount: 0,
            lastReplayAt: null,
            metadata: failedJob.metadata,
        };
        this.deadLetterJobs.set(deadLetter.id, deadLetter);

        this.deploymentQueueEventService.emit(
            "jobFailed",
            { queue: "deployment" },
            {
                jobId: failedJob.id,
                workerId: failedJob.workerId,
                jobType: failedJob.type,
                status: failedJob.status,
                deploymentId: failedJob.payload.deploymentId,
                serviceId: failedJob.payload.serviceId,
                projectId: failedJob.payload.projectId,
                error: input.error,
                movedToDeadLetter: true,
                job: failedJob,
                deadLetterJob: deadLetter,
                timestamp: failedJob.updatedAt,
            },
        );

        this.replicateQueueTransition({
            job: failedJob,
            fromStatus: existing.status,
            toStatus: failedJob.status,
            workerId: failedJob.workerId,
            idempotencyKey: `${failedJob.id}:failed:${failedJob.updatedAt}`,
        });

        return {
            transition: { updated: true, job: failedJob },
            failedJob,
            movedToDeadLetter: true,
        };
    }

    private replicateQueueTransition(input: {
        job: DeploymentQueueJob;
        fromStatus: string | null;
        toStatus: string;
        workerId: string | null;
        idempotencyKey: string;
    }): void {
        if (!this.meshQueueTransitionService) {
            return;
        }

        const partitionKey = input.job.payload.deploymentId
            ? `deployment:${input.job.payload.deploymentId}`
            : `job:${input.job.id}`;
        void this.meshQueueTransitionService.appendAndReplicate({
            queue: "deployment",
            partitionKey,
            jobId: input.job.id,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            workerId: input.workerId,
            idempotencyKey: input.idempotencyKey,
            occurredAt: input.job.updatedAt,
            metadata: {
                serviceId: input.job.payload.serviceId,
                projectId: input.job.payload.projectId,
                deploymentId: input.job.payload.deploymentId,
                jobType: input.job.type,
                attempts: input.job.attempts,
            },
        }).catch(() => {
            // Best-effort mesh replication must not block queue lifecycle progression.
        });
    }

    findQueueJobById(jobId: string): DeploymentQueueJob | null {
        return this.queueJobs.get(jobId) ?? null;
    }

    listQueueJobs(input: QueueListFilters): QueueListOutput {
        const filtered = [...this.queueJobs.values()]
            .filter((job) => !input.type || job.type === input.type)
            .filter((job) => !input.status || job.status === input.status)
            .filter((job) => !input.workerId || job.workerId === input.workerId)
            .filter((job) => !input.deploymentId || job.payload.deploymentId === input.deploymentId)
            .filter((job) => !input.serviceId || job.payload.serviceId === input.serviceId)
            .filter((job) => !input.projectId || job.payload.projectId === input.projectId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

        const items = filtered.slice(input.offset, input.offset + input.limit);
        return {
            items,
            total: filtered.length,
            hasMore: input.offset + input.limit < filtered.length,
        };
    }

    listDeadLetterJobs(input: DeploymentDeadLetterListInput): DeploymentDeadLetterListResult {
        const filtered = [...this.deadLetterJobs.values()]
            .filter((item) => !input.type || item.type === input.type)
            .filter((item) => !input.reason || item.reason === input.reason)
            .filter((item) => !input.from || item.movedAt >= input.from)
            .filter((item) => !input.to || item.movedAt <= input.to)
            .sort((a, b) => b.movedAt.localeCompare(a.movedAt));

        const items = filtered.slice(input.offset, input.offset + input.limit);
        return {
            items,
            total: filtered.length,
            hasMore: input.offset + input.limit < filtered.length,
        };
    }

    findDeadLetterJobById(deadLetterJobId: string): DeploymentDeadLetterJob | null {
        return this.deadLetterJobs.get(deadLetterJobId) ?? null;
    }

    replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): DeploymentDeadLetterReplayResult {
        const item = this.deadLetterJobs.get(input.deadLetterJobId);
        if (!item) {
            throw new NotFoundException(`Dead-letter job '${input.deadLetterJobId}' not found`);
        }

        const payload =
            input.replayMode === "patched_payload"
                ? { ...item.payload, ...(input.payloadPatch ?? {}) }
                : item.payload;

        const enqueued = this.enqueueQueueJob({
            type: item.type,
            idempotencyKey: `${item.idempotencyKey}:replay:${String(item.replayCount + 1)}`,
            payload,
            maxAttempts: item.maxAttempts,
            availableAt: input.scheduledAt,
            metadata: {
                deadLetterJobId: item.id,
                replayMode: input.replayMode,
                reason: input.reason,
                requestedBy: input.requestedBy,
            },
        });

        const updatedDeadLetter: DeploymentDeadLetterJob = {
            ...item,
            replayCount: item.replayCount + 1,
            lastReplayAt: new Date().toISOString(),
        };
        this.deadLetterJobs.set(item.id, updatedDeadLetter);

        this.deploymentQueueEventService.emit(
            "deadLetterReplayed",
            { queue: "deployment" },
            {
                queue: "deployment",
                deadLetterJobId: item.id,
                replayJobId: enqueued.job.id,
                replayCount: updatedDeadLetter.replayCount,
                timestamp: updatedDeadLetter.lastReplayAt ?? new Date().toISOString(),
            },
        );

        return {
            replayed: enqueued.enqueued,
            deadLetterJobId: item.id,
            replayJobId: enqueued.job.id,
            replayCount: updatedDeadLetter.replayCount,
            message: "Dead-letter job replayed successfully",
        };
    }

    private canClaimQueueJob(
        job: DeploymentQueueJob,
        input: DeploymentQueueClaimInput,
        now: number,
    ): boolean {
        return (
            job.status === "queued" &&
            new Date(job.availableAt).getTime() <= now &&
            (!input.types || input.types.includes(job.type))
        );
    }

    onModuleDestroy(): void {
        if (this.leaseReapTimer) {
            clearInterval(this.leaseReapTimer);
            this.leaseReapTimer = null;
        }
        for (const [, timer] of this.retryTimers) {
            clearTimeout(timer);
        }
        this.retryTimers.clear();
    }

    /**
     * W-Queue (Q2): return claims whose lease expired (worker died without
     * heartbeating) to the claimable pool. `claimed`/`running` jobs with an
     * expired `leaseExpiresAt` are reset to `queued` (fresh `availableAt`),
     * clearing the worker + lock token so another execution can claim them.
     * `attempts` are untouched: an interrupted execution is not a failure.
     */
    reapExpiredLeases(now: number = Date.now()): number {
        let reaped = 0;
        for (const [jobId, job] of this.queueJobs) {
            if (job.status !== "claimed" && job.status !== "running") {
                continue;
            }
            if (!job.leaseExpiresAt) {
                continue;
            }
            if (new Date(job.leaseExpiresAt).getTime() > now) {
                continue;
            }

            const released: DeploymentQueueJob = {
                ...job,
                status: "queued",
                workerId: null,
                lockToken: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: null,
                availableAt: new Date(now + DeploymentQueueLifecycleService.REAPED_AVAILABLE_DELAY_MS).toISOString(),
                updatedAt: new Date(now).toISOString(),
            };
            this.queueJobs.set(jobId, released);

            this.deploymentQueueEventService.emit(
                "jobFailed",
                { queue: "deployment" },
                {
                    jobId: released.id,
                    workerId: released.workerId,
                    jobType: released.type,
                    status: released.status,
                    deploymentId: released.payload.deploymentId,
                    serviceId: released.payload.serviceId,
                    projectId: released.payload.projectId,
                    error: "Execution lease expired — worker lost; job released for re-execution",
                    movedToDeadLetter: false,
                    job: released,
                    deadLetterJob: null,
                    timestamp: released.updatedAt,
                },
            );

            this.replicateQueueTransition({
                job: released,
                fromStatus: job.status,
                toStatus: released.status,
                workerId: job.workerId,
                idempotencyKey: `${released.id}:lease-released:${released.updatedAt}`,
            });

            reaped += 1;
        }
        return reaped;
    }

    /**
     * Re-emit a retried job on `jobQueued$` exactly when `availableAt` passes,
     * so the worker (which drains serially on that channel) re-executes it.
     * The emit is safe under dedupe: if the job was already claimed/completed by
     * another path (e.g. DLQ replay), the worker's claim-by-idempotency-key
     * returns null and it skips as "stale" — idempotent by design.
     */
    private scheduleRetryReEmit(retryJob: DeploymentQueueJob): void {
        const existing = this.retryTimers.get(retryJob.id);
        if (existing) {
            clearTimeout(existing);
        }

        const now = Date.now();
        const delayMs = Math.max(0, new Date(retryJob.availableAt).getTime() - now);

        const timer = setTimeout(() => {
            // Ensure the job is still queued-and-not-yet-executed before
            // re-emitting (guard against a completed/replayed job racing the timer).
            const current = this.queueJobs.get(retryJob.id);
            if (current && current.status === "queued" && current.attempts === retryJob.attempts) {
                this.jobQueued$.next(current);
            }
            this.retryTimers.delete(retryJob.id);
        }, delayMs);

        this.retryTimers.set(retryJob.id, timer);
    }

    private claimQueueJob(
        job: DeploymentQueueJob,
        input: DeploymentQueueClaimInput,
        now: number,
    ): DeploymentQueueJob {
        const previousStatus = job.status;
        const claimedAt = new Date(now).toISOString();
        const leaseExpiresAt = new Date(now + input.leaseDurationSec * 1000).toISOString();
        const updated: DeploymentQueueJob = {
            ...job,
            status: "claimed",
            workerId: input.workerId,
            lockToken: randomUUID(),
            connectivityStatus: input.workerConnectivityStatus ?? job.connectivityStatus,
            startedAt: job.startedAt ?? claimedAt,
            leaseExpiresAt,
            updatedAt: claimedAt,
        };
        this.queueJobs.set(updated.id, updated);

        this.deploymentQueueEventService.emit(
            "jobClaimed",
            { queue: "deployment" },
            {
                jobId: updated.id,
                workerId: updated.workerId,
                jobType: updated.type,
                status: updated.status,
                deploymentId: updated.payload.deploymentId,
                serviceId: updated.payload.serviceId,
                projectId: updated.payload.projectId,
                claimedCount: 1,
                job: updated,
                timestamp: updated.updatedAt,
            },
        );

        this.replicateQueueTransition({
            job: updated,
            fromStatus: previousStatus,
            toStatus: updated.status,
            workerId: updated.workerId,
            idempotencyKey: `${updated.id}:claimed:${updated.updatedAt}`,
        });

        return updated;
    }
}
