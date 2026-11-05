import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import type {
  DeploymentQueueClaimResult,
  DeploymentDeadLetterJob,
  DeploymentDeadLetterListInput,
  DeploymentDeadLetterListResult,
  DeploymentDeadLetterReplayInput,
  DeploymentDeadLetterReplayResult,
  DeploymentQueueClaimInput,
  DeploymentQueueEnqueueInput,
  DeploymentQueueEnqueueResult,
  DeploymentQueueFailInput,
  DeploymentQueueHeartbeatInput,
  DeploymentQueueJob,
  DeploymentQueueTransitionResult,
} from "@deployer/contracts-entities";

import { getSharedApiRuntimeContext, withDeploymentQueueWorkerDisabled } from "@/e2e/runtime";
import { DeploymentQueueLifecycle } from "@/modules/deployment/queue/deployment-queue-lifecycle.service";

export type DeploymentQueueLifecyclePort = {
  enqueueQueueJob(input: DeploymentQueueEnqueueInput): Promise<DeploymentQueueEnqueueResult>;
  claimQueueJobs(input: DeploymentQueueClaimInput): Promise<DeploymentQueueClaimResult>;
  claimQueueJobByIdempotencyKey(
    idempotencyKey: string,
    input: DeploymentQueueClaimInput,
  ): Promise<DeploymentQueueJob | null>;
  heartbeatQueueJob(
    jobId: string,
    input: DeploymentQueueHeartbeatInput,
  ): Promise<{ acknowledged: true; leaseExpiresAt: string | null; lastHeartbeatAt: string | null; observedConnectivityStatus: string | null; observedAt: string } | null>;
  failQueueJob(
    jobId: string,
    input: DeploymentQueueFailInput,
  ): Promise<{
    transition: DeploymentQueueTransitionResult;
    failedJob: DeploymentQueueJob;
    movedToDeadLetter: boolean;
  } | null>;
  completeQueueJob(
    jobId: string,
    workerId: string,
    lockToken: string,
    result: Record<string, unknown> | undefined,
  ): Promise<DeploymentQueueTransitionResult | null>;
  listQueueJobs(input: {
    type?: DeploymentQueueJob["type"];
    status?: DeploymentQueueJob["status"];
    workerId?: string;
    deploymentId?: string;
    serviceId?: string;
    projectId?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: DeploymentQueueJob[]; total: number; hasMore: boolean }>;
  listDeadLetterJobs(input: DeploymentDeadLetterListInput): Promise<DeploymentDeadLetterListResult>;
  findDeadLetterJobById(deadLetterJobId: string): Promise<DeploymentDeadLetterJob | null>;
  replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): Promise<DeploymentDeadLetterReplayResult>;
  findQueueJobById(jobId: string): Promise<DeploymentQueueJob | null>;
  cancelQueueJob(jobId: string, reason: string): Promise<DeploymentQueueJob | null>;
  reapExpiredLeases(now?: Date): Promise<number>;
}

export type DeploymentQueueWorkflowContext = {
  deploymentQueueLifecycleService: DeploymentQueueLifecyclePort;
  workerId: string;
  projectId: string;
  serviceId: string;
}

export async function createDeploymentQueueWorkflowContext(): Promise<DeploymentQueueWorkflowContext> {
  // The suites claim, heartbeat and complete jobs themselves: the live worker would race them for every queued job.
  const context = await getSharedApiRuntimeContext(withDeploymentQueueWorkerDisabled());
  // The lifecycle is an Effect service; the workflows below drive it as Promises, so lift each method once.
  const lifecycle = context.serviceMapper.get(DeploymentQueueLifecycle) as unknown as Record<string, unknown>;
  const deploymentQueueLifecycleService = Object.fromEntries(
    Object.entries(lifecycle)
      .filter(([, member]) => typeof member === "function")
      .map(([name, member]) => [
        name,
        (...args: unknown[]) => Effect.runPromise((member as (...a: unknown[]) => Effect.Effect<unknown>)(...args)),
      ]),
  ) as unknown as DeploymentQueueLifecyclePort;

  return {
    deploymentQueueLifecycleService,
    workerId: `e2e-worker-${randomUUID()}`,
    projectId: randomUUID(),
    serviceId: randomUUID(),
  };
}
