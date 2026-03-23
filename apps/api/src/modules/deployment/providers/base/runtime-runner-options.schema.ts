import z from "zod/v4";

const dockerfileRunnerAdvancedOptionsSchema = z
    .object({
        containerName: z.string().min(1).optional(),
    })
    .strict();

const dockerComposeRunnerAdvancedOptionsSchema = z
    .object({
        containerName: z.string().min(1).optional(),
        networkMode: z.string().min(1).optional(),
        profiles: z.array(z.string().min(1)).min(1).optional(),
    })
    .strict();

const nixpacksRunnerAdvancedOptionsSchema = z
    .object({
        cpuShares: z.number().positive().optional(),
    })
    .strict();

const buildpackRunnerAdvancedOptionsSchema = z
    .object({
        memoryLimitBytes: z.number().positive().optional(),
        builder: z.string().min(1).optional(),
    })
    .strict();

const railpackRunnerAdvancedOptionsSchema = z
    .object({
        healthCheckUrl: z.string().min(1).optional(),
        startupCommand: z.string().min(1).optional(),
    })
    .strict();

export const runtimeRunnerOptionsSchema = z.object({
    containerName: z.string().min(1).optional(),
    networkMode: z.string().min(1).optional(),
    cpuShares: z.number().positive().optional(),
    memoryLimitBytes: z.number().positive().optional(),
    healthCheckUrl: z.string().min(1).optional(),
    healthCheckMaxRetries: z.number().int().positive().optional(),
    healthCheckRetryIntervalMs: z.number().int().positive().optional(),
    traefikSyncMaxAttempts: z.number().int().positive().optional(),
    loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
    convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
    startupCommand: z.string().min(1).optional(),
    dockerfile: dockerfileRunnerAdvancedOptionsSchema.optional(),
    dockerCompose: dockerComposeRunnerAdvancedOptionsSchema.optional(),
    nixpacks: nixpacksRunnerAdvancedOptionsSchema.optional(),
    buildpack: buildpackRunnerAdvancedOptionsSchema.optional(),
    railpack: railpackRunnerAdvancedOptionsSchema.optional(),
});

export type RuntimeRunnerOptions = z.infer<typeof runtimeRunnerOptionsSchema>;
