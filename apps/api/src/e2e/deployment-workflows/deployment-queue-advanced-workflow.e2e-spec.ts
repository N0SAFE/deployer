import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertClaimedByWorker,
  parseClaimResult,
  parseDeadLetterJob,
  parseDeadLetterListResult,
  parseDeadLetterReplayResult,
  parseEnqueueResult,
  parseHeartbeatResult,
  parseQueueJob,
  parseQueueListResult,
  parseTransitionResult,
} from "./support/deployment-queue-workflow-assertions";
import {
  createDeploymentQueueWorkflowContext,
  type DeploymentQueueWorkflowContext,
} from "./support/deployment-queue-workflow-context";

describe("Deployment queue e2e: advanced lifecycle workflow", () => {
  let context: DeploymentQueueWorkflowContext;

  beforeAll(async () => {
    context = await createDeploymentQueueWorkflowContext();
  });

  it("deduplicates enqueue by idempotency key and supports typed queue filters", () => {
    const idempotencyKey = `e2e:queue:dedupe:${randomUUID()}`;

    const first = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 3,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
          context: {
            source: "e2e-dedupe",
          },
        },
      }),
    );

    const second = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 3,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
          context: {
            source: "e2e-dedupe",
          },
        },
      }),
    );

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const list = parseQueueListResult(
      context.deploymentQueueLifecycleService.listQueueJobs({
        projectId: context.projectId,
        limit: 50,
        offset: 0,
      }),
    );

    expect(list.items.some((item) => item.id === first.job.id)).toBe(true);
  });

  it("executes retry-to-dead-letter then replay-to-complete workflow", () => {
    const idempotencyKey = `e2e:queue:lifecycle:${randomUUID()}`;

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 2,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
          context: {
            source: "e2e-lifecycle",
          },
        },
      }),
    );

    const initialClaimRaw = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      idempotencyKey,
      {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(initialClaimRaw).not.toBeNull();

    if (!initialClaimRaw) {
      throw new Error("Expected initial queue claim by idempotency key");
    }

    const initialClaim = parseQueueJob(initialClaimRaw);

    if (!initialClaim.lockToken) {
      throw new Error("Expected claimed queue job with lock token");
    }

    assertClaimedByWorker(initialClaim, context.workerId);

    const badHeartbeat = context.deploymentQueueLifecycleService.heartbeatQueueJob(initialClaim.id, {
      workerId: context.workerId,
      lockToken: "invalid-lock-token",
      extendLeaseSec: 120,
    });
    expect(badHeartbeat).toBeNull();

    const heartbeat = parseHeartbeatResult(
      context.deploymentQueueLifecycleService.heartbeatQueueJob(initialClaim.id, {
        workerId: context.workerId,
        lockToken: initialClaim.lockToken,
        connectivityStatus: "connected",
        extendLeaseSec: 120,
      }),
    );
    expect(heartbeat.acknowledged).toBe(true);
    expect(heartbeat.observedConnectivityStatus).toBe("connected");

    const firstFailureResult = context.deploymentQueueLifecycleService.failQueueJob(initialClaim.id, {
      workerId: context.workerId,
      lockToken: initialClaim.lockToken,
      error: "transient-failure",
      retryable: true,
      retryAt: new Date().toISOString(),
    });

    expect(firstFailureResult).not.toBeNull();

    if (!firstFailureResult) {
      throw new Error("Expected first failure transition result");
    }

    const firstFailure = parseTransitionResult(firstFailureResult.transition);

    expect(firstFailure.job.status).toBe("queued");
    expect(firstFailure.job.attempts).toBe(1);

    const secondClaimRaw = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      idempotencyKey,
      {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(secondClaimRaw).not.toBeNull();

    if (!secondClaimRaw) {
      throw new Error("Expected second queue claim after retry");
    }

    const secondClaim = parseQueueJob(secondClaimRaw);

    if (!secondClaim.lockToken) {
      throw new Error("Expected retried queue job claim with lock token");
    }

    const secondFailureResult = context.deploymentQueueLifecycleService.failQueueJob(secondClaim.id, {
      workerId: context.workerId,
      lockToken: secondClaim.lockToken,
      error: "persistent-failure",
      retryable: true,
    });

    expect(secondFailureResult).not.toBeNull();

    if (!secondFailureResult) {
      throw new Error("Expected second failure transition result");
    }

    const secondFailure = parseTransitionResult(secondFailureResult.transition);

    expect(secondFailure.job.status).toBe("failed");
    expect(secondFailure.job.attempts).toBe(2);

    const deadLetters = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        type: "cleanup",
        reason: "max_attempts_exceeded",
        limit: 50,
        offset: 0,
      }),
    );

    const deadLetter = deadLetters.items.find((item) => item.originalJobId === enqueued.job.id);
    expect(deadLetter).toBeDefined();

    if (!deadLetter) {
      throw new Error("Expected dead-letter item after max attempts exceeded");
    }

    const validatedDeadLetter = parseDeadLetterJob(deadLetter);

    const replay = parseDeadLetterReplayResult(
      context.deploymentQueueLifecycleService.replayDeadLetterJob({
        deadLetterJobId: validatedDeadLetter.id,
        replayMode: "same_payload",
        requestedBy: context.workerId,
        reason: "e2e-recovery-check",
      }),
    );

    expect(replay.replayed).toBe(true);
    expect(replay.replayJobId).toBeTypeOf("string");

    if (!replay.replayJobId) {
      throw new Error("Expected replay job id");
    }

    const replayJobRaw = context.deploymentQueueLifecycleService.findQueueJobById(replay.replayJobId);
    expect(replayJobRaw).not.toBeNull();

    if (!replayJobRaw) {
      throw new Error("Expected replay job to exist in queue store");
    }

    const replayJob = parseQueueJob(replayJobRaw);
    expect(replayJob.status).toBe("queued");

    const replayClaimRaw = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      `${validatedDeadLetter.idempotencyKey}:replay:1`,
      {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(replayClaimRaw).not.toBeNull();

    if (!replayClaimRaw) {
      throw new Error("Expected replay queue claim by replay idempotency key");
    }

    const replayClaim = parseQueueJob(replayClaimRaw);

    if (!replayClaim.lockToken) {
      throw new Error("Expected replayed queue job claim with lock token");
    }

    const completionResult = context.deploymentQueueLifecycleService.completeQueueJob(
      replayClaim.id,
      context.workerId,
      replayClaim.lockToken,
      {
        outcome: "recovered",
      },
    );

    expect(completionResult).not.toBeNull();

    if (!completionResult) {
      throw new Error("Expected completion transition result");
    }

    const completion = parseTransitionResult(completionResult);

    expect(completion.job.status).toBe("succeeded");
    expect(completion.job.completedAt).toBeTypeOf("string");
  });

  it("supports batch claims with type filters, availability windows, and claim limits", () => {
    const futureAvailableAt = new Date(Date.now() + 60_000).toISOString();

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "cleanup",
      idempotencyKey: `e2e:queue:batch:cleanup:${randomUUID()}`,
      maxAttempts: 3,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
        context: {
          source: "e2e-batch-cleanup",
        },
      },
    });

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "deploy",
      idempotencyKey: `e2e:queue:batch:deploy:future:${randomUUID()}`,
      maxAttempts: 3,
      availableAt: futureAvailableAt,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
        context: {
          source: "e2e-batch-deploy-future",
        },
      },
    });

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "deploy",
      idempotencyKey: `e2e:queue:batch:deploy:ready:${randomUUID()}`,
      maxAttempts: 3,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
        context: {
          source: "e2e-batch-deploy-ready",
        },
      },
    });

    const deployClaim = parseClaimResult(
      context.deploymentQueueLifecycleService.claimQueueJobs({
        workerId: context.workerId,
        types: ["deploy"],
        limit: 1,
        leaseDurationSec: 120,
      }),
    );

    expect(deployClaim.claimed).toHaveLength(1);
    expect(deployClaim.claimed[0]?.type).toBe("deploy");

    const secondDeployClaim = parseClaimResult(
      context.deploymentQueueLifecycleService.claimQueueJobs({
        workerId: context.workerId,
        types: ["deploy"],
        limit: 2,
        leaseDurationSec: 120,
      }),
    );
    expect(secondDeployClaim.claimed).toHaveLength(0);

    const cleanupClaim = parseClaimResult(
      context.deploymentQueueLifecycleService.claimQueueJobs({
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      }),
    );
    expect(cleanupClaim.claimed).toHaveLength(1);
    expect(cleanupClaim.claimed[0]?.type).toBe("cleanup");
  });

  it("replays dead-letter jobs with patched payload and persists replay metadata", () => {
    const idempotencyKey = `e2e:queue:patched-replay:${randomUUID()}`;
    const patchedDeploymentId = randomUUID();

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 2,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
          context: {
            source: "e2e-patched-replay-original",
          },
        },
      }),
    );

    const claimRaw = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    expect(claimRaw).not.toBeNull();
    if (!claimRaw?.lockToken) {
      throw new Error("Expected claimed queue job lock token for patched replay test");
    }

    const failure = context.deploymentQueueLifecycleService.failQueueJob(claimRaw.id, {
      workerId: context.workerId,
      lockToken: claimRaw.lockToken,
      error: "fatal-non-retryable",
      retryable: false,
    });

    expect(failure).not.toBeNull();

    const deadLetters = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        reason: "non_retryable_error",
        limit: 50,
        offset: 0,
      }),
    );

    const deadLetter = deadLetters.items.find((item) => item.originalJobId === enqueued.job.id);
    expect(deadLetter).toBeDefined();
    if (!deadLetter) {
      throw new Error("Expected dead-letter job for non-retryable failure");
    }

    const replay = parseDeadLetterReplayResult(
      context.deploymentQueueLifecycleService.replayDeadLetterJob({
        deadLetterJobId: deadLetter.id,
        replayMode: "patched_payload",
        payloadPatch: {
          deploymentId: patchedDeploymentId,
          context: {
            source: "e2e-patched-replay-updated",
          },
        },
        requestedBy: context.workerId,
        reason: "e2e-patched-replay",
      }),
    );

    expect(replay.replayed).toBe(true);
    expect(replay.replayCount).toBe(1);

    const replayJob = context.deploymentQueueLifecycleService.findQueueJobById(replay.replayJobId);
    expect(replayJob).not.toBeNull();
    if (!replayJob) {
      throw new Error("Expected replayed queue job to exist");
    }

    const parsedReplayJob = parseQueueJob(replayJob);
    expect(parsedReplayJob.payload.deploymentId).toBe(patchedDeploymentId);
    expect(parsedReplayJob.metadata).toMatchObject({
      deadLetterJobId: deadLetter.id,
      replayMode: "patched_payload",
      requestedBy: context.workerId,
    });

    const replayDeadLetter = parseDeadLetterJob(
      context.deploymentQueueLifecycleService.findDeadLetterJobById(deadLetter.id),
    );
    expect(replayDeadLetter.replayCount).toBe(1);
    expect(replayDeadLetter.lastReplayAt).toBeTypeOf("string");
  });

  it("paginates dead-letter listings and reports replay errors for unknown jobs", () => {
    const failingKeyA = `e2e:queue:dead-letter-page:a:${randomUUID()}`;
    const failingKeyB = `e2e:queue:dead-letter-page:b:${randomUUID()}`;

    const failOnce = (idempotencyKey: string) => {
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 1,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
        },
      });

      const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      });

      if (!claimed?.lockToken) {
        throw new Error(`Expected lock token for job ${idempotencyKey}`);
      }

      const failed = context.deploymentQueueLifecycleService.failQueueJob(claimed.id, {
        workerId: context.workerId,
        lockToken: claimed.lockToken,
        error: "pagination-check",
        retryable: false,
      });

      expect(failed).not.toBeNull();
    };

    failOnce(failingKeyA);
    failOnce(failingKeyB);

    const firstPage = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        reason: "non_retryable_error",
        limit: 1,
        offset: 0,
      }),
    );
    const secondPage = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        reason: "non_retryable_error",
        limit: 1,
        offset: 1,
      }),
    );

    expect(firstPage.total).toBeGreaterThanOrEqual(2);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.items).toHaveLength(1);

    expect(() =>
      context.deploymentQueueLifecycleService.replayDeadLetterJob({
        deadLetterJobId: randomUUID(),
        replayMode: "same_payload",
        requestedBy: context.workerId,
        reason: "e2e-missing-dead-letter",
      }),
    ).toThrow(NotFoundException);
  });

  it("preserves claimed job state when completion/failure lock validation fails", () => {
    const idempotencyKey = `e2e:queue:lock-safety:${randomUUID()}`;

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 2,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
        },
      }),
    );

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    expect(claimed).not.toBeNull();
    if (!claimed?.lockToken) {
      throw new Error("Expected claimed queue job lock token");
    }

    const rejectedCompletion = context.deploymentQueueLifecycleService.completeQueueJob(
      claimed.id,
      context.workerId,
      "invalid-lock-token",
      { outcome: "should-not-apply" },
    );
    expect(rejectedCompletion).toBeNull();

    const rejectedFailure = context.deploymentQueueLifecycleService.failQueueJob(claimed.id, {
      workerId: `${context.workerId}-mismatch`,
      lockToken: claimed.lockToken,
      error: "should-not-apply",
      retryable: false,
    });
    expect(rejectedFailure).toBeNull();

    const persistedClaim = parseQueueJob(
      context.deploymentQueueLifecycleService.findQueueJobById(enqueued.job.id),
    );
    expect(persistedClaim.status).toBe("claimed");
    expect(persistedClaim.lockToken).toBe(claimed.lockToken);

    const completion = context.deploymentQueueLifecycleService.completeQueueJob(
      claimed.id,
      context.workerId,
      claimed.lockToken,
      { outcome: "lock-check-recovered" },
    );
    expect(completion).not.toBeNull();
  });

  it("queues retry with default backoff when retryable failure omits retryAt", () => {
    const idempotencyKey = `e2e:queue:default-retry:${randomUUID()}`;
    const failureStartMs = Date.now();

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "cleanup",
      idempotencyKey,
      maxAttempts: 3,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
        context: {
          source: "type-filter",
        },
      },
    });

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    if (!claimed?.lockToken) {
      throw new Error("Expected queue claim for default retry test");
    }

    const failure = context.deploymentQueueLifecycleService.failQueueJob(claimed.id, {
      workerId: context.workerId,
      lockToken: claimed.lockToken,
      error: "default-retry-window",
      retryable: true,
    });

    expect(failure).not.toBeNull();
    if (!failure) {
      throw new Error("Expected retry transition for default retry test");
    }

    const retriedJob = parseQueueJob(failure.transition.job);
    expect(retriedJob.status).toBe("queued");
    expect(retriedJob.attempts).toBe(1);
    expect(retriedJob.lastError).toBe("default-retry-window");
    expect(new Date(retriedJob.availableAt).getTime()).toBeGreaterThanOrEqual(failureStartMs + 4_000);

    const immediateClaim = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });
    expect(immediateClaim).toBeNull();
  });

  it("propagates worker connectivity status through claim and heartbeat", () => {
    const idempotencyKey = `e2e:queue:connectivity:${randomUUID()}`;

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "cleanup",
      idempotencyKey,
      maxAttempts: 2,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
      },
    });

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
      workerConnectivityStatus: "degraded",
    });

    if (!claimed?.lockToken) {
      throw new Error("Expected claimed queue job with lock token for connectivity test");
    }

    expect(claimed.connectivityStatus).toBe("degraded");

    const heartbeat = context.deploymentQueueLifecycleService.heartbeatQueueJob(claimed.id, {
      workerId: context.workerId,
      lockToken: claimed.lockToken,
      extendLeaseSec: 120,
    });

    expect(heartbeat).not.toBeNull();
    if (!heartbeat?.acknowledged) {
      throw new Error("Expected acknowledged heartbeat for connectivity test");
    }

    expect(heartbeat.observedConnectivityStatus).toBe("degraded");

    const persisted = parseQueueJob(
      context.deploymentQueueLifecycleService.findQueueJobById(claimed.id),
    );
    expect(persisted.connectivityStatus).toBe("degraded");

    const workerScopedList = parseQueueListResult(
      context.deploymentQueueLifecycleService.listQueueJobs({
        workerId: context.workerId,
        status: "running",
        limit: 20,
        offset: 0,
      }),
    );

    expect(workerScopedList.items.some((item) => item.id === claimed.id)).toBe(true);
  });

  it("preserves existing metadata and appends completion result", () => {
    const idempotencyKey = `e2e:queue:metadata-completion:${randomUUID()}`;

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 2,
        metadata: {
          source: "e2e-metadata",
          traceId: randomUUID(),
        },
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
          context: {
            source: "non-retryable-flow",
          },
        },
      }),
    );

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    if (!claimed?.lockToken) {
      throw new Error("Expected claimed queue job with lock token for metadata test");
    }

    const completion = context.deploymentQueueLifecycleService.completeQueueJob(
      claimed.id,
      context.workerId,
      claimed.lockToken,
      {
        outcome: "e2e-metadata-complete",
        durationMs: 42,
      },
    );

    expect(completion).not.toBeNull();

    const persisted = parseQueueJob(
      context.deploymentQueueLifecycleService.findQueueJobById(enqueued.job.id),
    );

    expect(persisted.status).toBe("succeeded");
    expect(persisted.metadata).toMatchObject({
      source: "e2e-metadata",
      result: {
        outcome: "e2e-metadata-complete",
        durationMs: 42,
      },
    });
  });

  it("keeps scheduled dead-letter replays queued until availability window and supports scoped queue filters", () => {
    const scopedProjectId = randomUUID();
    const scopedServiceId = randomUUID();
    const idempotencyKey = `e2e:queue:scheduled-replay:${randomUUID()}`;
    const scheduledAt = new Date(Date.now() + 120_000).toISOString();

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 1,
        payload: {
          projectId: scopedProjectId,
          serviceId: scopedServiceId,
          context: {
            source: "e2e-scheduled-replay",
          },
        },
      }),
    );

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    if (!claimed?.lockToken) {
      throw new Error("Expected claimed queue job for scheduled replay test");
    }

    context.deploymentQueueLifecycleService.failQueueJob(claimed.id, {
      workerId: context.workerId,
      lockToken: claimed.lockToken,
      error: "schedule-replay",
      retryable: false,
    });

    const deadLetter = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        type: "cleanup",
        reason: "non_retryable_error",
        limit: 50,
        offset: 0,
      }),
    ).items.find((item) => item.originalJobId === enqueued.job.id);

    expect(deadLetter).toBeDefined();
    if (!deadLetter) {
      throw new Error("Expected dead-letter entry for scheduled replay test");
    }

    const replay = parseDeadLetterReplayResult(
      context.deploymentQueueLifecycleService.replayDeadLetterJob({
        deadLetterJobId: deadLetter.id,
        replayMode: "same_payload",
        scheduledAt,
        requestedBy: context.workerId,
        reason: "e2e-scheduled-replay",
      }),
    );

    const replayJob = parseQueueJob(
      context.deploymentQueueLifecycleService.findQueueJobById(replay.replayJobId),
    );
    expect(replayJob.status).toBe("queued");
    expect(replayJob.availableAt).toBe(scheduledAt);

    const replayClaim = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      `${deadLetter.idempotencyKey}:replay:1`,
      {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );
    expect(replayClaim).toBeNull();

    const scopedQueuedList = parseQueueListResult(
      context.deploymentQueueLifecycleService.listQueueJobs({
        projectId: scopedProjectId,
        status: "queued",
        limit: 20,
        offset: 0,
      }),
    );
    expect(scopedQueuedList.items.some((item) => item.id === replay.replayJobId)).toBe(true);
    expect(scopedQueuedList.items.every((item) => item.payload.projectId === scopedProjectId)).toBe(true);
  });

  it("respects claim type filters for idempotency-key claims", () => {
    const idempotencyKey = `e2e:queue:type-filter:${randomUUID()}`;

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "cleanup",
      idempotencyKey,
      maxAttempts: 2,
      payload: {
        projectId: context.projectId,
        serviceId: context.serviceId,
      },
    });

    const rejectedByType = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      idempotencyKey,
      {
        workerId: context.workerId,
        types: ["deploy"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(rejectedByType).toBeNull();

    const acceptedByType = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(
      idempotencyKey,
      {
        workerId: context.workerId,
        types: ["cleanup"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(acceptedByType).not.toBeNull();
    expect(acceptedByType?.type).toBe("cleanup");
  });

  it("transitions claimed job to failed + dead-letter for non-retryable failure", () => {
    const idempotencyKey = `e2e:queue:non-retryable:${randomUUID()}`;

    const enqueued = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "cleanup",
        idempotencyKey,
        maxAttempts: 4,
        payload: {
          projectId: context.projectId,
          serviceId: context.serviceId,
        },
      }),
    );

    const claimed = context.deploymentQueueLifecycleService.claimQueueJobByIdempotencyKey(idempotencyKey, {
      workerId: context.workerId,
      types: ["cleanup"],
      limit: 1,
      leaseDurationSec: 120,
    });

    if (!claimed?.lockToken) {
      throw new Error("Expected lock token for non-retryable failure flow");
    }

    const failure = context.deploymentQueueLifecycleService.failQueueJob(claimed.id, {
      workerId: context.workerId,
      lockToken: claimed.lockToken,
      error: "fatal-non-retryable-flow",
      retryable: false,
    });

    expect(failure).not.toBeNull();
    if (!failure) {
      throw new Error("Expected failure transition result for non-retryable flow");
    }

    expect(failure.movedToDeadLetter).toBe(true);
    expect(failure.transition.job.status).toBe("failed");
    expect(failure.transition.job.attempts).toBe(1);
    expect(failure.transition.job.completedAt).toBeTypeOf("string");
    expect(failure.transition.job.lastError).toBe("fatal-non-retryable-flow");

    const deadLetter = parseDeadLetterListResult(
      context.deploymentQueueLifecycleService.listDeadLetterJobs({
        reason: "non_retryable_error",
        limit: 20,
        offset: 0,
      }),
    ).items.find((item) => item.originalJobId === enqueued.job.id);

    expect(deadLetter).toBeDefined();
    expect(deadLetter?.reason).toBe("non_retryable_error");
    expect(deadLetter?.attempts).toBe(1);
  });

  it("supports combined queue filters by deployment + service + type + status", () => {
    const deploymentId = randomUUID();
    const serviceId = randomUUID();
    const projectId = randomUUID();

    const matchingJob = parseEnqueueResult(
      context.deploymentQueueLifecycleService.enqueueQueueJob({
        type: "deploy",
        idempotencyKey: `e2e:queue:combined-filter:match:${randomUUID()}`,
        maxAttempts: 2,
        payload: {
          deploymentId,
          serviceId,
          projectId,
          environment: "preview",
          context: {
            source: "combined-filter-match",
          },
        },
      }),
    );

    context.deploymentQueueLifecycleService.enqueueQueueJob({
      type: "cleanup",
      idempotencyKey: `e2e:queue:combined-filter:noise:${randomUUID()}`,
      maxAttempts: 2,
      payload: {
        deploymentId,
        serviceId,
        projectId,
        context: {
          source: "combined-filter-noise",
        },
      },
    });

    const filtered = parseQueueListResult(
      context.deploymentQueueLifecycleService.listQueueJobs({
        deploymentId,
        serviceId,
        projectId,
        type: "deploy",
        status: "queued",
        limit: 20,
        offset: 0,
      }),
    );

    expect(filtered.items.length).toBeGreaterThanOrEqual(1);
    expect(filtered.items.some((item) => item.id === matchingJob.job.id)).toBe(true);
    expect(filtered.items.every((item) => item.type === "deploy")).toBe(true);
    expect(filtered.items.every((item) => item.status === "queued")).toBe(true);
    expect(filtered.items.every((item) => item.payload.deploymentId === deploymentId)).toBe(true);
    expect(filtered.items.every((item) => item.payload.serviceId === serviceId)).toBe(true);
    expect(filtered.items.every((item) => item.payload.projectId === projectId)).toBe(true);
  });
});
