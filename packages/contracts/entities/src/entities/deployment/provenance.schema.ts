import z from "zod/v4";
import { templateKindSchema, templateScopeSchema, templateVersionSchema } from "../template";

export const deploymentTemplateProvenanceSourceSchema = z.enum(["template", "inlineOverride", "runtimeDefault"]);
export type DeploymentTemplateProvenanceSource = z.infer<typeof deploymentTemplateProvenanceSourceSchema>;

export const deploymentTemplateProvenanceLayerSchema = z.enum(["global", "provider", "project", "environment", "run"]);
export type DeploymentTemplateProvenanceLayer = z.infer<typeof deploymentTemplateProvenanceLayerSchema>;

export const deploymentTemplateProvenanceEntrySchema = z.object({
    kind: templateKindSchema,
    templateId: z.uuid(),
    version: templateVersionSchema,
    scope: templateScopeSchema,
    source: deploymentTemplateProvenanceSourceSchema,
    appliedLayer: deploymentTemplateProvenanceLayerSchema,
    resolvedFromLayers: z.array(deploymentTemplateProvenanceLayerSchema).default([]),
    overridePatch: z.record(z.string(), z.unknown()).nullable(),
    digest: z.string().nullable(),
});
export type DeploymentTemplateProvenanceEntry = z.infer<typeof deploymentTemplateProvenanceEntrySchema>;

export const deploymentTemplateProvenanceSchema = z.object({
    id: z.uuid(),
    deploymentId: z.uuid(),
    runId: z.uuid().nullable(),
    planHash: z.string().nullable(),
    templates: z.array(deploymentTemplateProvenanceEntrySchema),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    capturedAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DeploymentTemplateProvenance = z.infer<typeof deploymentTemplateProvenanceSchema>;

export const deploymentTemplateProvenanceUpsertInputSchema = z.object({
    deploymentId: z.uuid(),
    runId: z.uuid().optional(),
    planHash: z.string().optional(),
    templates: z.array(deploymentTemplateProvenanceEntrySchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DeploymentTemplateProvenanceUpsertInput = z.infer<typeof deploymentTemplateProvenanceUpsertInputSchema>;

export const deploymentTemplateProvenanceUpsertResultSchema = z.object({
    persisted: z.boolean(),
    provenance: deploymentTemplateProvenanceSchema,
});
export type DeploymentTemplateProvenanceUpsertResult = z.infer<typeof deploymentTemplateProvenanceUpsertResultSchema>;

export const deploymentTemplateProvenanceByRunResultSchema = z.object({
    runId: z.uuid(),
    records: z.array(deploymentTemplateProvenanceSchema),
});
export type DeploymentTemplateProvenanceByRunResult = z.infer<typeof deploymentTemplateProvenanceByRunResultSchema>;
