import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentExecutionCancelInputSchema,
    deploymentExecutionCancelResultSchema,
    deploymentExecutionCheckpointByRunResultSchema,
    deploymentExecutionCheckpointSchema,
    deploymentExecutionResumeInputSchema,
    deploymentExecutionResumeResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentCancelExecutionContract = route({
    method: "POST",
    path: "/{id}/execution/cancel",
    summary: "Request cancellation for a running deployment execution",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/execution/cancel`)
            .body(deploymentExecutionCancelInputSchema),
    )
    .output(deploymentExecutionCancelResultSchema)
    .build();

export const deploymentResumeExecutionContract = route({
    method: "POST",
    path: "/{id}/execution/resume",
    summary: "Resume a cancelled/failed deployment execution from checkpoint",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/execution/resume`)
            .body(deploymentExecutionResumeInputSchema),
    )
    .output(deploymentExecutionResumeResultSchema)
    .build();

export const deploymentGetExecutionCheckpointContract = route({
    method: "GET",
    path: "/{id}/execution/checkpoint",
    summary: "Get latest execution checkpoint for a deployment",
})
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/execution/checkpoint`))
    .output(deploymentExecutionCheckpointSchema.nullable())
    .build();

export const deploymentGetExecutionCheckpointByRunContract = route({
    method: "GET",
    path: "/runs/{runId}/execution/checkpoint",
    summary: "Get execution checkpoint for a specific run",
})
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/execution/checkpoint`))
    .output(deploymentExecutionCheckpointByRunResultSchema)
    .build();
