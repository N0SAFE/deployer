import { standard } from "@repo/orpc-utils";
import {
    deploymentCompileRollbackEdgesInputSchema,
    deploymentCompileRollbackEdgesResultSchema,
    deploymentPlanCompileInputSchema,
    deploymentPlanCompileResultSchema,
} from "@repo/contracts-entities";

const deploymentPlanCompileOps = standard.zod(deploymentPlanCompileResultSchema, "deploymentPlanCompile");
const deploymentRollbackEdgesCompileOps = standard.zod(
    deploymentCompileRollbackEdgesResultSchema,
    "deploymentRollbackEdgesCompile",
);

export const deploymentCompilePlanContract = deploymentPlanCompileOps
    .create()
    .path("/compile-plan")
    .input((b) => b.body(deploymentPlanCompileInputSchema))
    .output(deploymentPlanCompileResultSchema)
    .build();

export const deploymentCompilePlanPreviewContract = deploymentPlanCompileOps
    .create()
    .path("/compile-plan/preview")
    .input((b) => b.body(deploymentPlanCompileInputSchema))
    .output(deploymentPlanCompileResultSchema)
    .build();

export const deploymentCompileRollbackEdgesContract = deploymentRollbackEdgesCompileOps
    .create()
    .path("/compile-plan/rollback-edges")
    .input((b) => b.body(deploymentCompileRollbackEdgesInputSchema))
    .output(deploymentCompileRollbackEdgesResultSchema)
    .build();
