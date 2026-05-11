import z from "zod/v4";
import { deploymentPhaseSchema } from "@repo/contracts-common";

export const deploymentPhaseGuardSchema = z.enum([
    "requiresCompiledPlan",
    "requiresHealthyDependencies",
    "requiresRouteSync",
    "requiresActiveLease",
    "requiresNoCancellation",
]);
export type DeploymentPhaseGuard = z.infer<typeof deploymentPhaseGuardSchema>;

export const deploymentPhaseTransitionSchema = z.object({
    from: deploymentPhaseSchema,
    to: deploymentPhaseSchema,
    allowed: z.boolean(),
    guards: z.array(deploymentPhaseGuardSchema).default([]),
    reason: z.string().nullable(),
});
export type DeploymentPhaseTransition = z.infer<typeof deploymentPhaseTransitionSchema>;

export const deploymentPhaseViolationSchema = z.object({
    guard: deploymentPhaseGuardSchema,
    message: z.string().min(1),
    severity: z.enum(["error", "warning"]).default("error"),
});
export type DeploymentPhaseViolation = z.infer<typeof deploymentPhaseViolationSchema>;

export const deploymentPhaseTransitionValidationInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid().optional(),
    currentPhase: deploymentPhaseSchema,
    targetPhase: deploymentPhaseSchema,
    context: z.record(z.string(), z.unknown()).default({}),
});
export type DeploymentPhaseTransitionValidationInput = z.infer<
    typeof deploymentPhaseTransitionValidationInputSchema
>;

export const deploymentPhaseTransitionValidationResultSchema = z.object({
    valid: z.boolean(),
    transition: deploymentPhaseTransitionSchema,
    violations: z.array(deploymentPhaseViolationSchema).default([]),
});
export type DeploymentPhaseTransitionValidationResult = z.infer<
    typeof deploymentPhaseTransitionValidationResultSchema
>;

export const deploymentPhaseTransitionApplyInputSchema = deploymentPhaseTransitionValidationInputSchema.extend({
    force: z.boolean().default(false),
    actorId: z.string().optional(),
});
export type DeploymentPhaseTransitionApplyInput = z.infer<typeof deploymentPhaseTransitionApplyInputSchema>;

export const deploymentPhaseTransitionApplyResultSchema = z.object({
    applied: z.boolean(),
    deploymentId: z.uuid(),
    previousPhase: deploymentPhaseSchema,
    currentPhase: deploymentPhaseSchema,
    transition: deploymentPhaseTransitionSchema,
    violations: z.array(deploymentPhaseViolationSchema).default([]),
});
export type DeploymentPhaseTransitionApplyResult = z.infer<typeof deploymentPhaseTransitionApplyResultSchema>;

export const deploymentPhaseTransitionsCatalogSchema = z.object({
    transitions: z.array(deploymentPhaseTransitionSchema),
});
export type DeploymentPhaseTransitionsCatalog = z.infer<typeof deploymentPhaseTransitionsCatalogSchema>;
