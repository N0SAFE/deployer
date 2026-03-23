import z from "zod/v4";

export const serviceSchema = z.object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.string(),
    providerId: z.string(),
    providerConfig: z.record(z.string(), z.unknown()).nullable(),
    builderId: z.string(),
    builderConfig: z.record(z.string(), z.unknown()).nullable(),
    port: z.number().int().nullable(),
    environmentVariables: z.record(z.string(), z.string()).nullable(),
    resourceLimits: z
        .object({
            memory: z.string().optional(),
            cpu: z.string().optional(),
            storage: z.string().optional(),
        })
        .nullable(),
    healthCheckPath: z.string().nullable(),
    healthCheckInterval: z.number().int().nullable(),
    healthCheckTimeout: z.number().int().nullable(),
    healthCheckRetries: z.number().int().nullable(),
    deploymentRetention: z
        .object({
            maxSuccessfulDeployments: z.number().optional(),
            keepArtifacts: z.boolean().optional(),
            autoCleanup: z.boolean().optional(),
            cleanupSchedule: z.string().optional(),
        })
        .nullable(),
    traefikConfig: z.record(z.string(), z.unknown()).nullable(),
    customDomains: z.array(z.string()).nullable(),
    isActive: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export type Service = z.infer<typeof serviceSchema>;
