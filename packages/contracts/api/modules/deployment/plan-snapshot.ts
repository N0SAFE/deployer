import z from "zod/v4";
import { route } from "@repo/orpc-utils/builder";
import {
    deploymentCompiledPlanSnapshotByRunResultSchema,
    deploymentCompiledPlanSnapshotSchema,
    deploymentCreateCompiledPlanSnapshotInputSchema,
    deploymentCreateCompiledPlanSnapshotResultSchema,
    deploymentListCompiledPlanSnapshotsResultSchema,
} from "@repo/contracts-entities";

export const deploymentCreateCompiledPlanSnapshotContract = route({
    method: "POST",
    path: "/{id}/compiled-plan-snapshots",
    summary: "Persist immutable compiled plan snapshot for a deployment run",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/compiled-plan-snapshots`)
            .body(deploymentCreateCompiledPlanSnapshotInputSchema),
    )
    .output(deploymentCreateCompiledPlanSnapshotResultSchema)
    .build();

export const deploymentListCompiledPlanSnapshotsContract = route({
    method: "GET",
    path: "/{id}/compiled-plan-snapshots",
    summary: "List immutable compiled plan snapshots for a deployment",
})
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/compiled-plan-snapshots`))
    .output(deploymentListCompiledPlanSnapshotsResultSchema)
    .build();

export const deploymentGetCompiledPlanSnapshotContract = route({
    method: "GET",
    path: "/compiled-plan-snapshots/{snapshotId}",
    summary: "Get one immutable compiled plan snapshot by id",
})
    .input((b) => b.params((p) => p`/compiled-plan-snapshots/${p("snapshotId", z.uuid())}`))
    .output(deploymentCompiledPlanSnapshotSchema.nullable())
    .build();

export const deploymentGetCompiledPlanSnapshotByRunContract = route({
    method: "GET",
    path: "/runs/{runId}/compiled-plan-snapshot",
    summary: "Get immutable compiled plan snapshot associated with a run",
})
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/compiled-plan-snapshot`))
    .output(deploymentCompiledPlanSnapshotByRunResultSchema)
    .build();
