import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    deploymentNodeLifecycleEventEmitInputSchema,
    deploymentNodeLifecycleEventEmitResultSchema,
    deploymentNodeLifecycleEventListInputSchema,
    deploymentNodeLifecycleEventListResultSchema,
    deploymentNodeLifecycleEventSchema,
} from "@repo/contracts-entities";

const deploymentLifecycleEventEmitOps = standard.zod(
    deploymentNodeLifecycleEventEmitResultSchema,
    "deploymentLifecycleEventEmit",
);
const deploymentLifecycleEventListOps = standard.zod(
    deploymentNodeLifecycleEventListResultSchema,
    "deploymentLifecycleEventList",
);
const deploymentLifecycleEventStreamOps = standard.zod(
    deploymentNodeLifecycleEventSchema,
    "deploymentLifecycleEventStream",
);

export const deploymentEmitNodeLifecycleEventContract = deploymentLifecycleEventEmitOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/runs/${p("runId", z.uuid())}/lifecycle-events`)
            .body(deploymentNodeLifecycleEventEmitInputSchema),
    )
    .output(deploymentNodeLifecycleEventEmitResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentListNodeLifecycleEventsContract = deploymentLifecycleEventListOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/runs/${p("runId", z.uuid())}/lifecycle-events`)
            .query(deploymentNodeLifecycleEventListInputSchema.omit({ runId: true })),
    )
    .output(deploymentNodeLifecycleEventListResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentNodeLifecycleEventsStreamContract = deploymentLifecycleEventStreamOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/runs/${p("runId", z.uuid())}/lifecycle-events/stream`)
            .query(
                z.object({
                    fromSequence: z.coerce.number().int().min(0).optional(),
                    replay: z.coerce.boolean().default(false),
                    replayLimit: z.coerce.number().int().min(1).max(500).default(100),
                }),
            ),
    )
    .output((b) => b.observable(deploymentNodeLifecycleEventSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
