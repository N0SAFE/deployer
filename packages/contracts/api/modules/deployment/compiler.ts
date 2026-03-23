import { route } from "@repo/orpc-utils/builder";
import {
    deploymentCompileRollbackEdgesInputSchema,
    deploymentCompileRollbackEdgesResultSchema,
    deploymentPlanCompileInputSchema,
    deploymentPlanCompileResultSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentCompilePlanContract = route({
    method: "POST",
    path: "/compile-plan",
    summary: "Compile deterministic deployment plan (template + context -> DAG + hash)",
})
    .input((b) => b.body(deploymentPlanCompileInputSchema))
    .output(deploymentPlanCompileResultSchema)
    .build();

export const deploymentCompilePlanPreviewContract = route({
    method: "POST",
    path: "/compile-plan/preview",
    summary: "Compile deployment plan in preview mode without persistence",
})
    .input((b) => b.body(deploymentPlanCompileInputSchema))
    .output(deploymentPlanCompileResultSchema)
    .build();

export const deploymentCompileRollbackEdgesContract = route({
    method: "POST",
    path: "/compile-plan/rollback-edges",
    summary: "Compile rollback edges for a deployment execution graph",
})
    .input((b) => b.body(deploymentCompileRollbackEdgesInputSchema))
    .output(deploymentCompileRollbackEdgesResultSchema)
    .build();
