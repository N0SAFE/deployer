import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import {
    deploymentExecutionCancelInputSchema,
    deploymentExecutionCancelResultSchema,
    deploymentExecutionCheckpointByRunResultSchema,
    deploymentExecutionCheckpointSchema,
    deploymentExecutionResumeInputSchema,
    deploymentExecutionResumeResultSchema,
} from "@repo/contracts-entities";

const deploymentExecutionCancelOps = standard.zod(
    deploymentExecutionCancelResultSchema,
    "deploymentExecutionCancel",
);
const deploymentExecutionResumeOps = standard.zod(
    deploymentExecutionResumeResultSchema,
    "deploymentExecutionResume",
);
const deploymentExecutionCheckpointOps = standard.zod(
    deploymentExecutionCheckpointSchema,
    "deploymentExecutionCheckpoint",
);
const deploymentExecutionCheckpointByRunOps = standard.zod(
    deploymentExecutionCheckpointByRunResultSchema,
    "deploymentExecutionCheckpointByRun",
);

export const deploymentCancelExecutionContract = deploymentExecutionCancelOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/execution/cancel`)
            .body(deploymentExecutionCancelInputSchema),
    )
    .output(deploymentExecutionCancelResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentResumeExecutionContract = deploymentExecutionResumeOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/execution/resume`)
            .body(deploymentExecutionResumeInputSchema),
    )
    .output(deploymentExecutionResumeResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentGetExecutionCheckpointContract = deploymentExecutionCheckpointOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/execution/checkpoint`))
    .output(deploymentExecutionCheckpointSchema.nullable())
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const deploymentGetExecutionCheckpointByRunContract = deploymentExecutionCheckpointByRunOps
    .list()
    .input((b) => b.params((p) => p`/runs/${p("runId", z.uuid())}/execution/checkpoint`))
    .output(deploymentExecutionCheckpointByRunResultSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
