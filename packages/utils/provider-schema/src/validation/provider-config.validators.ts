import z from "zod/v4";

export const providerConfigValidators: Record<string, z.ZodType<Record<string, unknown>>> = {
    github: z.object({
        repositoryUrl: z.url(),
        branch: z.string().min(1).optional(),
        buildContext: z.string().optional(),
    }),
    static: z.object({
        artifactPath: z.string().min(1),
        cleanUrls: z.boolean().optional(),
    }),
};