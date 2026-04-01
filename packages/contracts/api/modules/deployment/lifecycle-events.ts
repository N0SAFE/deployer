import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentNodeLifecycleEventEmitInputSchema,
    deploymentNodeLifecycleEventEmitResultSchema,
    deploymentNodeLifecycleEventListInputSchema,
    deploymentNodeLifecycleEventListResultSchema,
    deploymentNodeLifecycleEventSchema,
} from "@repo/contracts-entities";

export const deploymentEmitNodeLifecycleEventContract = route({
    method: "POST",
    path: "/runs/{runId}/lifecycle-events",
    summary: "Emit typed lifecycle event for a deployment graph node",
})
    .input((b) =>
        b
            .params((p) => p`/runs/${p("runId", z.uuid())}/lifecycle-events`)
            .body(deploymentNodeLifecycleEventEmitInputSchema),
    )
    .output(deploymentNodeLifecycleEventEmitResultSchema)
    .build();

export const deploymentListNodeLifecycleEventsContract = route({
    method: "GET",
    path: "/runs/{runId}/lifecycle-events",
    summary: "List typed lifecycle events for deployment graph nodes",
})
    .input((b) =>
        b
            .params((p) => p`/runs/${p("runId", z.uuid())}/lifecycle-events`)
            .query(deploymentNodeLifecycleEventListInputSchema.omit({ runId: true })),
    )
    .output(deploymentNodeLifecycleEventListResultSchema)
    .build();

export const deploymentNodeLifecycleEventsStreamContract = route({
    method: "GET",
    path: "/runs/{runId}/lifecycle-events/stream",
    summary: "Stream typed lifecycle events for deployment graph nodes (SSE)",
})
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
    .build();
