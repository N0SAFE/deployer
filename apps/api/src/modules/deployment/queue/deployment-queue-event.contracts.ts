import * as z from "zod";
import { contractBuilder } from "@repo/nest-events";
import {
    deploymentQueueJobSchema,
    deploymentDeadLetterJobSchema,
    deploymentQueueJobTypeSchema,
    deploymentQueueJobStatusSchema,
} from "@repo/contracts-entities";

export const deploymentQueueEventFilterSchema = z.object({
    queue: z.literal("deployment").default("deployment"),
});

const deploymentQueueEventEnvelopeSchema = z.object({
    jobId: z.string(),
    workerId: z.string().nullable().optional(),
    jobType: deploymentQueueJobTypeSchema,
    status: deploymentQueueJobStatusSchema,
    deploymentId: z.string().optional(),
    serviceId: z.string().optional(),
    projectId: z.string().optional(),
    timestamp: z.string(),
});

export const deploymentQueueEventContracts = {
    jobEnqueued: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            deploymentQueueEventEnvelopeSchema.extend({
                deduplicated: z.boolean(),
                job: deploymentQueueJobSchema,
            }),
        )
        .build(),

    jobClaimed: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            deploymentQueueEventEnvelopeSchema.extend({
                claimedCount: z.number().int().min(1),
                job: deploymentQueueJobSchema,
            }),
        )
        .build(),

    jobHeartbeat: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            deploymentQueueEventEnvelopeSchema.extend({
                leaseExpiresAt: z.string().nullable(),
            }),
        )
        .build(),

    jobCompleted: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            deploymentQueueEventEnvelopeSchema.extend({
                job: deploymentQueueJobSchema,
            }),
        )
        .build(),

    jobFailed: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            deploymentQueueEventEnvelopeSchema.extend({
                error: z.string(),
                movedToDeadLetter: z.boolean(),
                job: deploymentQueueJobSchema,
                deadLetterJob: deploymentDeadLetterJobSchema.nullable(),
            }),
        )
        .build(),

    deadLetterReplayed: contractBuilder()
        .input(deploymentQueueEventFilterSchema)
        .output(
            z.object({
                queue: z.literal("deployment"),
                deadLetterJobId: z.string(),
                replayJobId: z.string().nullable(),
                replayCount: z.number().int().min(0),
                timestamp: z.string(),
            }),
        )
        .build(),
} as const;

export type DeploymentQueueEventContracts = typeof deploymentQueueEventContracts;
