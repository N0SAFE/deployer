import z from "zod/v4";

export const builderConfigValidators: Record<string, z.ZodType<Record<string, unknown>>> = {
    dockerfile: z.object({
        dockerfilePath: z.string().optional(),
        buildArgs: z.record(z.string(), z.unknown()).optional(),
    }),
    nixpacks: z.object({
        installCommand: z.string().optional(),
        buildCommand: z.string().optional(),
    }),
    // `static` removed: not a builder. The four entries below are the builders that
    // actually exist in `deploymentBuilderKindSchema`.
    docker_compose: z.object({
        composeFile: z.string().optional(),
        serviceName: z.string().optional(),
    }),
    buildpack: z.object({
        buildpackBuilder: z.string().optional(),
        buildCommand: z.string().min(1),
        startCommand: z.string().min(1),
    }),
    railpack: z.object({
        buildCommand: z.string().min(1),
        startCommand: z.string().min(1),
    }),
    external: z.object({
        image: z.string().min(1),
    }),
};