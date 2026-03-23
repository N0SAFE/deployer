import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentDeadLetterJobSchema,
    deploymentDeadLetterListInputSchema,
    deploymentDeadLetterListResultSchema,
    deploymentDeadLetterReplayInputSchema,
    deploymentDeadLetterReplayResultSchema,
    deploymentQueueClaimInputSchema,
    deploymentQueueClaimResultSchema,
    deploymentQueueCompleteInputSchema,
    deploymentQueueEnqueueInputSchema,
    deploymentQueueEnqueueResultSchema,
    deploymentQueueFailInputSchema,
    deploymentQueueHeartbeatInputSchema,
    deploymentQueueHeartbeatResultSchema,
    deploymentQueueJobSchema,
    deploymentQueueListInputSchema,
    deploymentQueueListResultSchema,
    deploymentQueueTransitionResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentQueueEnqueueJobContract = route({
    method: "POST",
    path: "/queue/jobs",
    summary: "Enqueue orchestration job with idempotency handling",
})
    .input((b) => b.body(deploymentQueueEnqueueInputSchema))
    .output(deploymentQueueEnqueueResultSchema)
    .build();

export const deploymentQueueClaimJobsContract = route({
    method: "POST",
    path: "/queue/jobs/claim",
    summary: "Claim available orchestration jobs for a worker",
})
    .input((b) => b.body(deploymentQueueClaimInputSchema))
    .output(deploymentQueueClaimResultSchema)
    .build();

export const deploymentQueueHeartbeatJobContract = route({
    method: "POST",
    path: "/queue/jobs/{jobId}/heartbeat",
    summary: "Refresh lease for a claimed orchestration job",
})
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/heartbeat`)
            .body(deploymentQueueHeartbeatInputSchema),
    )
    .output(deploymentQueueHeartbeatResultSchema)
    .build();

export const deploymentQueueCompleteJobContract = route({
    method: "POST",
    path: "/queue/jobs/{jobId}/complete",
    summary: "Mark orchestration job as completed",
})
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/complete`)
            .body(deploymentQueueCompleteInputSchema),
    )
    .output(deploymentQueueTransitionResultSchema)
    .build();

export const deploymentQueueFailJobContract = route({
    method: "POST",
    path: "/queue/jobs/{jobId}/fail",
    summary: "Mark orchestration job as failed and schedule retry if allowed",
})
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/fail`)
            .body(deploymentQueueFailInputSchema),
    )
    .output(deploymentQueueTransitionResultSchema)
    .build();

export const deploymentQueueFindJobByIdContract = route({
    method: "GET",
    path: "/queue/jobs/{jobId}",
    summary: "Get orchestration queue job by id",
})
    .input((b) => b.params((p) => p`/queue/jobs/${p("jobId", z.uuid())}`))
    .output(deploymentQueueJobSchema.nullable())
    .build();

export const deploymentQueueListJobsContract = route({
    method: "GET",
    path: "/queue/jobs",
    summary: "List orchestration queue jobs with typed filters",
})
    .input((b) => b.query(deploymentQueueListInputSchema))
    .output(deploymentQueueListResultSchema)
    .build();

export const deploymentQueueListDeadLetterJobsContract = route({
    method: "GET",
    path: "/queue/dead-letter",
    summary: "List dead-letter orchestration jobs",
})
    .input((b) => b.query(deploymentDeadLetterListInputSchema))
    .output(deploymentDeadLetterListResultSchema)
    .build();

export const deploymentQueueFindDeadLetterJobByIdContract = route({
    method: "GET",
    path: "/queue/dead-letter/{deadLetterJobId}",
    summary: "Get dead-letter orchestration job by id",
})
    .input((b) => b.params((p) => p`/queue/dead-letter/${p("deadLetterJobId", z.uuid())}`))
    .output(deploymentDeadLetterJobSchema.nullable())
    .build();

export const deploymentQueueReplayDeadLetterJobContract = route({
    method: "POST",
    path: "/queue/dead-letter/replay",
    summary: "Replay dead-letter orchestration job back into active queue",
})
    .input((b) => b.body(deploymentDeadLetterReplayInputSchema))
    .output(deploymentDeadLetterReplayResultSchema)
    .build();
