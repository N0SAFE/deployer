import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import {
    deploymentCompiledPlanSnapshotByRunResultSchema,
    deploymentCompiledPlanSnapshotSchema,
    deploymentCreateCompiledPlanSnapshotInputSchema,
    deploymentCreateCompiledPlanSnapshotResultSchema,
    deploymentListCompiledPlanSnapshotsResultSchema,
} from "@repo/contracts-entities";

const deploymentCreateCompiledPlanSnapshotOps = standard.zod(
    deploymentCreateCompiledPlanSnapshotResultSchema,
    "deploymentCreateCompiledPlanSnapshot",
);
const deploymentListCompiledPlanSnapshotsOps = standard.zod(
    deploymentListCompiledPlanSnapshotsResultSchema,
    "deploymentListCompiledPlanSnapshots",
);
const deploymentCompiledPlanSnapshotOps = standard.zod(
    deploymentCompiledPlanSnapshotSchema,
    "deploymentCompiledPlanSnapshot",
);
const deploymentCompiledPlanSnapshotByRunOps = standard.zod(
    deploymentCompiledPlanSnapshotByRunResultSchema,
    "deploymentCompiledPlanSnapshotByRun",
);

export const deploymentCreateCompiledPlanSnapshotContract = deploymentCreateCompiledPlanSnapshotOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/compiled-plan-snapshots`)
            .body(deploymentCreateCompiledPlanSnapshotInputSchema),
    )
    .output(deploymentCreateCompiledPlanSnapshotResultSchema)
    .build();

export const deploymentListCompiledPlanSnapshotsContract = deploymentListCompiledPlanSnapshotsOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/compiled-plan-snapshots`))
    .output(deploymentListCompiledPlanSnapshotsResultSchema)
    .build();

export const deploymentGetCompiledPlanSnapshotContract = deploymentCompiledPlanSnapshotOps
    .read({ idFieldName: "snapshotId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/compiled-plan-snapshots/${p("snapshotId", z.uuid())}`))
    .output(deploymentCompiledPlanSnapshotSchema.nullable())
    .build();

export const deploymentGetCompiledPlanSnapshotByRunContract = deploymentCompiledPlanSnapshotByRunOps
    .list()
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/compiled-plan-snapshot`))
    .output(deploymentCompiledPlanSnapshotByRunResultSchema)
    .build();
