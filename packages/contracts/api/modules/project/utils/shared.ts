import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { environmentStatusSchema } from "@repo/contracts-entities";

export const projectIdParamSchema = z.object({ id: z.uuid() });

export const projectEnvironmentParamsSchema = z.object({
    id: z.uuid(),
    environmentId: z.uuid(),
});

export const projectScopeSchema = z.enum(["project", "service", "environment", "global"]);

export const availableVariableEntrySchema = z.object({
    key: z.string(),
    path: z.string(),
    scope: z.string(),
    description: z.string().nullable(),
    example: z.string().nullable(),
});

export const environmentStatusOutputSchema = z.object({
    environmentId: z.uuid(),
    status: environmentStatusSchema,
    servicesCount: z.number(),
    healthyServicesCount: z.number(),
    lastChecked: z.string(),
});

export const resolvedVariablesOutputSchema = z.object({
    resolved: z.string(),
    variables: z.record(z.string(), z.string()),
});

export const projectEnvironmentStatusOps = standard.zod(
    environmentStatusOutputSchema,
    "projectEnvironmentStatus",
);

export const projectAvailableVariableOps = standard.zod(
    availableVariableEntrySchema,
    "projectAvailableVariable",
);

export const projectResolvedVariablesOps = standard.zod(
    resolvedVariablesOutputSchema,
    "projectResolvedVariables",
);
