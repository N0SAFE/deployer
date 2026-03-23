import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import z from "zod/v4";
import { runtimeRunnerOptionsSchema } from "./runtime-runner-options.schema";

export const githubSourceCheckoutContextSchema = z.object({
    provider: z.literal("github"),
    repositoryUrl: z.string().min(1),
    branch: z.string().min(1),
    commitSha: z.string().min(1).optional(),
    pullRequestNumber: z.number().int().positive().optional(),
});

export const uploadSourceCheckoutContextSchema = z.object({
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
});

export const customSourceCheckoutContextSchema = z.object({
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
});

export const deploymentSourceCheckoutContextSchema = z.discriminatedUnion("provider", [
    githubSourceCheckoutContextSchema,
    uploadSourceCheckoutContextSchema,
    customSourceCheckoutContextSchema,
]);

export type DeploymentSourceCheckoutContext = z.infer<typeof deploymentSourceCheckoutContextSchema>;

export interface DeploymentSourceProvider {
    readonly sourceType: string;
    resolveSourceCheckout(input: DeploymentTriggerInput): Promise<DeploymentSourceCheckoutContext | null>;
}