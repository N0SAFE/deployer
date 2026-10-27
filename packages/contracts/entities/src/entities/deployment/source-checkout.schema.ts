/**
 * Source Checkout Context Schemas — SSOT for what a source provider
 * (github / upload / custom / …) resolves a deployment trigger into.
 *
 * Discriminated union on `provider` — every provider has a typed shape,
 * no loose objects. Used by the providers module, the deployment queue
 * processor and the deployment execution workflow.
 */
import z from "zod/v4";
import { runtimeRunnerOptionsSchema } from "./runtime-runner-options.schema";

export const githubSourceCheckoutContextSchema = z.object({
    provider: z.literal("github"),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
});
export type GithubSourceCheckoutContext = z.infer<typeof githubSourceCheckoutContextSchema>;

export const gitlabSourceCheckoutContextSchema = z.object({
    provider: z.literal("gitlab"),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    commitSha: z.string().min(1).optional(),
    mergeRequestIid: z.number().int().positive().optional(),
});
export type GitlabSourceCheckoutContext = z.infer<typeof gitlabSourceCheckoutContextSchema>;

export const uploadSourceCheckoutContextSchema = z
    .object({
        provider: z.literal("upload"),
        uploadId: z.string().min(1),
        uploadPath: z.string().min(1).optional(),
        fileName: z.string().min(1).optional(),
        fileSize: z.number().nonnegative().optional(),
        containerImage: z.string().min(1).optional(),
        containerName: z.string().min(1).optional(),
        runtimeRunner: z.string().min(1).optional(),
        networkMode: z.string().min(1).optional(),
        cpuShares: z.number().positive().optional(),
        memoryLimitBytes: z.number().positive().optional(),
        healthCheckMaxRetries: z.number().int().positive().optional(),
        healthCheckRetryIntervalMs: z.number().int().positive().optional(),
        runtimeRunnerOptions: runtimeRunnerOptionsSchema.optional(),
    })
    .strict();
export type UploadSourceCheckoutContext = z.infer<typeof uploadSourceCheckoutContextSchema>;

export const customSourceCheckoutContextSchema = z
    .object({
        provider: z.literal("custom"),
        containerImage: z.string().min(1),
        containerName: z.string().min(1).optional(),
        runtimeRunner: z.string().min(1).optional(),
        networkMode: z.string().min(1).optional(),
        cpuShares: z.number().positive().optional(),
        memoryLimitBytes: z.number().positive().optional(),
        healthCheckMaxRetries: z.number().int().positive().optional(),
        healthCheckRetryIntervalMs: z.number().int().positive().optional(),
        runtimeRunnerOptions: runtimeRunnerOptionsSchema.optional(),
    })
    .strict();
export type CustomSourceCheckoutContext = z.infer<typeof customSourceCheckoutContextSchema>;

export const deploymentSourceCheckoutContextSchema = z.discriminatedUnion("provider", [
    githubSourceCheckoutContextSchema,
    gitlabSourceCheckoutContextSchema,
    uploadSourceCheckoutContextSchema,
    customSourceCheckoutContextSchema,
]);
export type DeploymentSourceCheckoutContext = z.infer<typeof deploymentSourceCheckoutContextSchema>;
