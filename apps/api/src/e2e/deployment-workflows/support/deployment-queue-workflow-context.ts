import { randomUUID } from "node:crypto";
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
} from "@repo/contracts-entities";
import { DeploymentQueueLifecycleService } from "@/modules/deployment/queue/deployment-queue-lifecycle.service";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

export interface DeploymentQueueLifecyclePort {
  enqueueQueueJob(input: DeploymentQueueEnqueueInput): DeploymentQueueEnqueueResult;
  claimQueueJobs(input: DeploymentQueueClaimInput): DeploymentQueueClaimResult;
  claimQueueJobByIdempotencyKey(
    idempotencyKey: string,
    input: DeploymentQueueClaimInput,
  ): DeploymentQueueJob | null;
  heartbeatQueueJob(
    jobId: string,
    input: DeploymentQueueHeartbeatInput,
  ): { acknowledged: false } | { acknowledged: true; leaseExpiresAt: string; lastHeartbeatAt: string | null; observedConnectivityStatus: string | null; observedAt: string };
  failQueueJob(
    jobId: string,
    input: DeploymentQueueFailInput,
  ):
    | {
        transition: DeploymentQueueTransitionResult;
        failedJob: DeploymentQueueJob;
        movedToDeadLetter: boolean;
      }
    | null;
  completeQueueJob(
    jobId: string,
    workerId: string,
    lockToken: string,
    result: Record<string, unknown> | undefined,
  ): DeploymentQueueTransitionResult | null;
  listQueueJobs(input: {
    type?: DeploymentQueueJob["type"];
    status?: DeploymentQueueJob["status"];
    workerId?: string;
    deploymentId?: string;
    serviceId?: string;
    projectId?: string;
    limit: number;
    offset: number;
  }): { items: DeploymentQueueJob[]; total: number; hasMore: boolean };
  listDeadLetterJobs(input: DeploymentDeadLetterListInput): DeploymentDeadLetterListResult;
  findDeadLetterJobById(deadLetterJobId: string): DeploymentDeadLetterJob | null;
  replayDeadLetterJob(input: DeploymentDeadLetterReplayInput): DeploymentDeadLetterReplayResult;
  findQueueJobById(jobId: string): DeploymentQueueJob | null;
}

export interface DeploymentQueueWorkflowContext {
  deploymentQueueLifecycleService: DeploymentQueueLifecyclePort;
  workerId: string;
  projectId: string;
  serviceId: string;
}

export async function createDeploymentQueueWorkflowContext(): Promise<DeploymentQueueWorkflowContext> {
  const context = await getSharedApiRuntimeContext();
  const deploymentQueueLifecycleService = context.serviceMapper.get(
    DeploymentQueueLifecycleService,
  ) as DeploymentQueueLifecyclePort;

  return {
    deploymentQueueLifecycleService,
    workerId: `e2e-worker-${randomUUID()}`,
    projectId: randomUUID(),
    serviceId: randomUUID(),
  };
}
