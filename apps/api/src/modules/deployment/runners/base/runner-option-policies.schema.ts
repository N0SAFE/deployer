import z from "zod/v4";

export const dockerfileRunnerOptionsSchema = z
    .object({
        containerName: z.string().min(1).optional(),
        startupCommand: z.string().min(1).optional(),
        traefikSyncMaxAttempts: z.number().int().positive().optional(),
        loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
        convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
        dockerfile: z
            .object({
                containerName: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const dockerComposeRunnerOptionsSchema = z
    .object({
        containerName: z.string().min(1).optional(),
        networkMode: z.string().min(1).optional(),
        startupCommand: z.string().min(1).optional(),
        traefikSyncMaxAttempts: z.number().int().positive().optional(),
        loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
        convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
        dockerCompose: z
            .object({
                containerName: z.string().min(1).optional(),
                networkMode: z.string().min(1).optional(),
                profiles: z.array(z.string().min(1)).min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const nixpacksRunnerOptionsSchema = z
    .object({
        cpuShares: z.number().positive().optional(),
        startupCommand: z.string().min(1).optional(),
        traefikSyncMaxAttempts: z.number().int().positive().optional(),
        loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
        convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
        nixpacks: z
            .object({
                cpuShares: z.number().positive().optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const buildpackRunnerOptionsSchema = z
    .object({
        memoryLimitBytes: z.number().positive().optional(),
        startupCommand: z.string().min(1).optional(),
        traefikSyncMaxAttempts: z.number().int().positive().optional(),
        loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
        convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
        buildpack: z
            .object({
                memoryLimitBytes: z.number().positive().optional(),
                builder: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const railpackRunnerOptionsSchema = z
    .object({
        healthCheckUrl: z.string().min(1).optional(),
        startupCommand: z.string().min(1).optional(),
        traefikSyncMaxAttempts: z.number().int().positive().optional(),
        loadBalancerSyncMaxAttempts: z.number().int().positive().optional(),
        convergenceRetryBaseDelayMs: z.number().int().positive().optional(),
        railpack: z
            .object({
                healthCheckUrl: z.string().min(1).optional(),
                startupCommand: z.string().min(1).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export type DockerfileRunnerOptions = z.infer<typeof dockerfileRunnerOptionsSchema>;
export type DockerComposeRunnerOptions = z.infer<typeof dockerComposeRunnerOptionsSchema>;
export type NixpacksRunnerOptions = z.infer<typeof nixpacksRunnerOptionsSchema>;
export type BuildpackRunnerOptions = z.infer<typeof buildpackRunnerOptionsSchema>;
export type RailpackRunnerOptions = z.infer<typeof railpackRunnerOptionsSchema>;
