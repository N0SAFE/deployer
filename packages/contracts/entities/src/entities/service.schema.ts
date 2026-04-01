import z from "zod/v4";
import {
    runnerNetworkModeSchema,
    serviceProviderTypeSchema,
    serviceRunnerStrategySchema,
    serviceRunnerTypeSchema,
} from "@repo/contracts-common";
import { traefikDynamicConfigSchema } from "./traefik.schema";

const githubProviderConfigSchema = z
    .object({
        sourceUrl: z.string().min(1),
        branch: z.string().min(1),
        rootPath: z.string().min(1),
        buildContext: z.string().min(1),
        dockerfilePath: z.string().optional(),
        image: z.string().optional(),
        autoSyncEnabled: z.boolean(),
        webhookEnabled: z.boolean(),
        authSecretRef: z.string().min(1),
    })
    .strict();

const gitlabProviderConfigSchema = githubProviderConfigSchema;
const bitbucketProviderConfigSchema = githubProviderConfigSchema;

const artifactBundleProviderConfigSchema = z
    .object({
        sourceUrl: z.string().min(1),
        branch: z.string().min(1),
        rootPath: z.string().min(1),
        buildContext: z.string().min(1),
        image: z.string().min(1),
        autoSyncEnabled: z.boolean(),
        webhookEnabled: z.boolean(),
        authSecretRef: z.string().min(1),
    })
    .strict();

const containerRegistryProviderConfigSchema = artifactBundleProviderConfigSchema;

const manualProviderConfigSchema = z
    .object({
        sourceUrl: z.string().min(1),
        branch: z.string().min(1),
        rootPath: z.string().min(1),
        buildContext: z.string().min(1),
        dockerfilePath: z.string().optional(),
        image: z.string().optional(),
        autoSyncEnabled: z.boolean(),
        webhookEnabled: z.boolean(),
        authSecretRef: z.string().min(1),
    })
    .strict();

const kubernetesRunnerConfigSchema = z
    .object({
        strategy: serviceRunnerStrategySchema,
        startCommand: z.string().min(1),
        args: z.array(z.string()),
        ports: z.array(z.int().positive()),
        volumeMounts: z.array(z.string()),
        secretRefs: z.array(z.string()),
        networkMode: runnerNetworkModeSchema,
        gracefulShutdownSeconds: z.int().min(0),
    })
    .strict();

const dockerComposeRunnerConfigSchema = kubernetesRunnerConfigSchema;
const dockerSwarmRunnerConfigSchema = kubernetesRunnerConfigSchema;
const workerRuntimeRunnerConfigSchema = kubernetesRunnerConfigSchema;
const nomadRunnerConfigSchema = kubernetesRunnerConfigSchema;
const staticRunnerConfigSchema = z
    .object({
        strategy: z.literal("recreate"),
        startCommand: z.string().min(1),
        args: z.array(z.string()),
        ports: z.array(z.int().positive()),
        volumeMounts: z.array(z.string()),
        secretRefs: z.array(z.string()),
        networkMode: runnerNetworkModeSchema,
        gracefulShutdownSeconds: z.int().min(0),
    })
    .strict();

const providerConfigSchemaById = {
    github: githubProviderConfigSchema,
    gitlab: gitlabProviderConfigSchema,
    bitbucket: bitbucketProviderConfigSchema,
    "artifact-bundle": artifactBundleProviderConfigSchema,
    "container-registry": containerRegistryProviderConfigSchema,
    manual: manualProviderConfigSchema,
} as const;

const runnerConfigSchemaById = {
    kubernetes: kubernetesRunnerConfigSchema,
    "docker-compose": dockerComposeRunnerConfigSchema,
    "docker-swarm": dockerSwarmRunnerConfigSchema,
    "worker-runtime": workerRuntimeRunnerConfigSchema,
    nomad: nomadRunnerConfigSchema,
    static: staticRunnerConfigSchema,
} as const;

const serviceProviderConfigUnionSchema = z.union([
    githubProviderConfigSchema,
    gitlabProviderConfigSchema,
    bitbucketProviderConfigSchema,
    artifactBundleProviderConfigSchema,
    containerRegistryProviderConfigSchema,
    manualProviderConfigSchema,
]);

const serviceRunnerConfigUnionSchema = z.union([
    kubernetesRunnerConfigSchema,
    dockerComposeRunnerConfigSchema,
    dockerSwarmRunnerConfigSchema,
    workerRuntimeRunnerConfigSchema,
    nomadRunnerConfigSchema,
    staticRunnerConfigSchema,
]);

export const serviceSchema = z
    .object({
        id: z.uuid(),
        projectId: z.uuid(),
        name: z.string(),
        description: z.string().nullable(),
        type: z.string(),
        providerId: serviceProviderTypeSchema,
        providerConfig: serviceProviderConfigUnionSchema,
        builderId: serviceRunnerTypeSchema,
        builderConfig: serviceRunnerConfigUnionSchema,
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
        traefikConfig: traefikDynamicConfigSchema.nullable(),
        customDomains: z.array(z.string()).nullable(),
        isActive: z.boolean(),
        metadata: z.record(z.string(), z.unknown()).nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
    })
    .superRefine((service, ctx) => {
        const providerSchema = providerConfigSchemaById[service.providerId];
        if (!providerSchema.safeParse(service.providerConfig).success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["providerConfig"],
                message: `providerConfig does not match providerId '${service.providerId}'.`,
            });
        }

        const runnerSchema = runnerConfigSchemaById[service.builderId];
        if (!runnerSchema.safeParse(service.builderConfig).success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["builderConfig"],
                message: `builderConfig does not match builderId '${service.builderId}'.`,
            });
        }
    });

export type Service = z.infer<typeof serviceSchema>;
