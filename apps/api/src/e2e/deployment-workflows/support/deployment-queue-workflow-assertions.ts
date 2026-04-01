import {
  deploymentDeadLetterJobSchema,
  deploymentDeadLetterListResultSchema,
  deploymentDeadLetterReplayResultSchema,
  deploymentQueueClaimResultSchema,
  deploymentQueueEnqueueResultSchema,
  deploymentQueueHeartbeatResultSchema,
  deploymentQueueJobSchema,
  deploymentQueueListResultSchema,
  deploymentQueueTransitionResultSchema,
  type DeploymentDeadLetterJob,
  type DeploymentQueueJob,
} from "@repo/contracts-entities";
import { expect } from "vitest";

export function parseQueueJob(value: unknown): DeploymentQueueJob {
  return deploymentQueueJobSchema.parse(value);
}

export function parseEnqueueResult(value: unknown) {
  return deploymentQueueEnqueueResultSchema.parse(value);
}

export function parseClaimResult(value: unknown) {
  return deploymentQueueClaimResultSchema.parse(value);
}

export function parseHeartbeatResult(value: unknown) {
  return deploymentQueueHeartbeatResultSchema.parse(value);
}

export function parseTransitionResult(value: unknown) {
  return deploymentQueueTransitionResultSchema.parse(value);
}

export function parseQueueListResult(value: unknown) {
  return deploymentQueueListResultSchema.parse(value);
}

export function parseDeadLetterJob(value: unknown): DeploymentDeadLetterJob {
  return deploymentDeadLetterJobSchema.parse(value);
}

export function parseDeadLetterListResult(value: unknown) {
  return deploymentDeadLetterListResultSchema.parse(value);
}

export function parseDeadLetterReplayResult(value: unknown) {
  return deploymentDeadLetterReplayResultSchema.parse(value);
}

export function assertClaimedByWorker(job: DeploymentQueueJob, workerId: string): void {
  expect(job.status).toBe("claimed");
  expect(job.workerId).toBe(workerId);
  expect(job.lockToken).toBeTypeOf("string");
  expect(job.lockToken).not.toBe("");
}
