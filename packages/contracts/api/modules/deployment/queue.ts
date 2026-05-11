import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
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
} from "@repo/contracts-entities";

const deploymentQueueEnqueueOps = standard.zod(
    deploymentQueueEnqueueResultSchema,
    "deploymentQueueEnqueue",
);
const deploymentQueueClaimOps = standard.zod(
    deploymentQueueClaimResultSchema,
    "deploymentQueueClaim",
);
const deploymentQueueHeartbeatOps = standard.zod(
    deploymentQueueHeartbeatResultSchema,
    "deploymentQueueHeartbeat",
);
const deploymentQueueTransitionOps = standard.zod(
    deploymentQueueTransitionResultSchema,
    "deploymentQueueTransition",
);
const deploymentQueueJobOps = standard.zod(deploymentQueueJobSchema, "deploymentQueueJob");
const deploymentQueueListOps = standard.zod(deploymentQueueListResultSchema, "deploymentQueueList");
const deploymentDeadLetterListOps = standard.zod(
    deploymentDeadLetterListResultSchema,
    "deploymentDeadLetterList",
);
const deploymentDeadLetterJobOps = standard.zod(
    deploymentDeadLetterJobSchema,
    "deploymentDeadLetterJob",
);
const deploymentDeadLetterReplayOps = standard.zod(
    deploymentDeadLetterReplayResultSchema,
    "deploymentDeadLetterReplay",
);

export const deploymentQueueEnqueueJobContract = deploymentQueueEnqueueOps
    .create()
    .path("/queue/jobs")
    .input((b) => b.body(deploymentQueueEnqueueInputSchema))
    .output(deploymentQueueEnqueueResultSchema)
    .build();

export const deploymentQueueClaimJobsContract = deploymentQueueClaimOps
    .create()
    .path("/queue/jobs/claim")
    .input((b) => b.body(deploymentQueueClaimInputSchema))
    .output(deploymentQueueClaimResultSchema)
    .build();

export const deploymentQueueHeartbeatJobContract = deploymentQueueHeartbeatOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/heartbeat`)
            .body(deploymentQueueHeartbeatInputSchema),
    )
    .output(deploymentQueueHeartbeatResultSchema)
    .build();

export const deploymentQueueCompleteJobContract = deploymentQueueTransitionOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/complete`)
            .body(deploymentQueueCompleteInputSchema),
    )
    .output(deploymentQueueTransitionResultSchema)
    .build();

export const deploymentQueueFailJobContract = deploymentQueueTransitionOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/queue/jobs/${p("jobId", z.uuid())}/fail`)
            .body(deploymentQueueFailInputSchema),
    )
    .output(deploymentQueueTransitionResultSchema)
    .build();

export const deploymentQueueFindJobByIdContract = deploymentQueueJobOps
    .read({ idFieldName: "jobId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/queue/jobs/${p("jobId", z.uuid())}`))
    .output(deploymentQueueJobSchema.nullable())
    .build();

export const deploymentQueueListJobsContract = deploymentQueueListOps
    .list()
    .path("/queue/jobs")
    .input((b) => b.query(deploymentQueueListInputSchema))
    .output(deploymentQueueListResultSchema)
    .build();

export const deploymentQueueListDeadLetterJobsContract = deploymentDeadLetterListOps
    .list()
    .path("/queue/dead-letter")
    .input((b) => b.query(deploymentDeadLetterListInputSchema))
    .output(deploymentDeadLetterListResultSchema)
    .build();

export const deploymentQueueFindDeadLetterJobByIdContract = deploymentDeadLetterJobOps
    .read({ idFieldName: "deadLetterJobId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/queue/dead-letter/${p("deadLetterJobId", z.uuid())}`))
    .output(deploymentDeadLetterJobSchema.nullable())
    .build();

export const deploymentQueueReplayDeadLetterJobContract = deploymentDeadLetterReplayOps
    .create()
    .path("/queue/dead-letter/replay")
    .input((b) => b.body(deploymentDeadLetterReplayInputSchema))
    .output(deploymentDeadLetterReplayResultSchema)
    .build();
