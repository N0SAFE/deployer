import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import {
    deploymentSchema,
    deploymentStatusSchema,
    deploymentEnvironmentSchema,
    sourceTypeSchema,
    deploymentLogSchema,
    deploymentRollbackSchema,
} from "@repo/contracts-entities";

const deploymentOps = standard.zod(deploymentSchema, "deployment");

// ─── findById ────────────────────────────────────────────────────────────────

export const deploymentFindByIdContract = deploymentOps
    .read()
    .output((b) => b.entitySchema.nullable())
    .build();

// ─── delete ──────────────────────────────────────────────────────────────────

export const deploymentDeleteContract = deploymentOps.delete().build();

// ─── trigger ─────────────────────────────────────────────────────────────────

export const deploymentTriggerInputSchema = z.object({
    serviceId: z.uuid(),
    environment: deploymentEnvironmentSchema.default("production"),
    sourceType: sourceTypeSchema,
    sourceConfig: z
        .object({
            repositoryUrl: z.string().optional(),
            branch: z.string().optional(),
            commitSha: z.string().optional(),
            pullRequestNumber: z.number().int().positive().optional(),
            fileName: z.string().optional(),
            fileSize: z.number().optional(),
            customData: z.record(z.string(), z.unknown()).optional(),
        })
        .optional(),
    execution: z
        .object({
            builder: z
                .enum(["dockerfile", "docker_compose", "nixpacks", "buildpack", "railpack", "external"])
                .optional(),
            runner: z
                .enum(["docker", "dockerfile", "docker_compose", "nixpacks", "buildpack", "railpack"])
                .optional(),
            runtimeRunnerOptions: z.record(z.string(), z.unknown()).optional(),
            customCommands: z
                .object({
                    cli: z
                        .object({
                            node: z.boolean().optional(),
                            bun: z.boolean().optional(),
                            npm: z.boolean().optional(),
                            pnpm: z.boolean().optional(),
                            yarn: z.boolean().optional(),
                        })
                        .optional(),
                    buildCommand: z.string().min(1).optional(),
                    runCommand: z.string().min(1).optional(),
                })
                .optional(),
            healthChecks: z
                .object({
                    build: z
                        .object({
                            maxRetries: z.number().int().positive().optional(),
                            retryIntervalMs: z.number().int().positive().optional(),
                        })
                        .optional(),
                    deploy: z
                        .object({
                            maxRetries: z.number().int().positive().optional(),
                            retryIntervalMs: z.number().int().positive().optional(),
                        })
                        .optional(),
                    runtime: z
                        .object({
                            maxRetries: z.number().int().positive().optional(),
                            retryIntervalMs: z.number().int().positive().optional(),
                        })
                        .optional(),
                })
                .optional(),
        })
        .optional(),
});
export type DeploymentTriggerInput = z.infer<typeof deploymentTriggerInputSchema>;

export const deploymentTriggerOutputSchema = z.object({
    deploymentId: z.uuid(),
    status: deploymentStatusSchema,
    message: z.string(),
});

const deploymentTriggerOps = standard.zod(deploymentTriggerOutputSchema, "deploymentTrigger");

export const deploymentTriggerContract = deploymentTriggerOps
    .create()
    .path("/trigger")
    .input((b) => b.body(deploymentTriggerInputSchema))
    .output(deploymentTriggerOutputSchema)
    .build();

// ─── upload bundle ────────────────────────────────────────────────────────────

export const deploymentUploadBundleOutputSchema = z.object({
    uploadId: z.string().min(1),
    uploadPath: z.string().min(1),
    fileName: z.string().min(1),
    fileSize: z.number().int().nonnegative(),
    mimeType: z.string().min(1),
});

const deploymentUploadBundleOps = standard.zod(
    deploymentUploadBundleOutputSchema,
    "deploymentUploadBundle",
);

export const deploymentUploadBundleContract = deploymentUploadBundleOps
    .create()
    .path("/upload-bundle")
    .input((b) =>
        b.body(
            z.object({
                file: z.file(),
                fileName: z.string().min(1).optional(),
            }),
        ),
    )
    .output(deploymentUploadBundleOutputSchema)
    .build();

// ─── cancel ──────────────────────────────────────────────────────────────────

export const deploymentCancelOutputSchema = z.object({
    success: z.boolean(),
    message: z.string(),
    deploymentId: z.uuid(),
    cancelledAt: z.date(),
});

const deploymentCancelOps = standard.zod(deploymentCancelOutputSchema, "deploymentCancel");

export const deploymentCancelContract = deploymentCancelOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/cancel`)
            .body(z.object({ reason: z.string().optional() })),
    )
    .output(deploymentCancelOutputSchema)
    .build();

// ─── rollback ────────────────────────────────────────────────────────────────

export const deploymentRollbackOutputSchema = z.object({
    rollbackDeploymentId: z.uuid(),
    message: z.string(),
});

const deploymentRollbackOps = standard.zod(deploymentRollbackOutputSchema, "deploymentRollback");

export const deploymentRollbackContract = deploymentRollbackOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/rollback`)
            .body(
                z.object({
                    targetDeploymentId: z.uuid(),
                    reason: z.string().optional(),
                }),
            ),
    )
    .output(deploymentRollbackOutputSchema)
    .build();

// ─── getLogs ─────────────────────────────────────────────────────────────────

export const deploymentGetLogsOutputSchema = z.object({
    logs: z.array(deploymentLogSchema),
    total: z.number().int(),
    hasMore: z.boolean(),
    retrySummary: z
        .object({
            scope: z.literal("deployment"),
            build: z.object({
                retryEvents: z.number().int().min(0),
            }),
            deploy: z.object({
                retryEvents: z.number().int().min(0),
            }),
            totalRetryEvents: z.number().int().min(0),
        })
        .optional(),
});

const deploymentGetLogsOps = standard.zod(deploymentGetLogsOutputSchema, "deploymentGetLogs");

export const deploymentGetLogsContract = deploymentGetLogsOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/logs`)
            .query(
                z.object({
                    limit: z.coerce.number().int().min(1).max(500).default(100),
                    offset: z.coerce.number().int().min(0).default(0),
                    level: deploymentLogSchema.shape.level.optional(),
                    phase: z.string().min(1).max(128).optional(),
                    step: z.string().min(1).max(128).optional(),
                    includeRetrySummary: z.coerce.boolean().default(false),
                }),
            ),
    )
    .output(deploymentGetLogsOutputSchema)
    .build();

// ─── retry ───────────────────────────────────────────────────────────────────

export const deploymentRetryOutputSchema = z.object({
    retryDeploymentId: z.uuid(),
    message: z.string(),
});

const deploymentRetryOps = standard.zod(deploymentRetryOutputSchema, "deploymentRetry");

export const deploymentRetryContract = deploymentRetryOps
    .create()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/retry`))
    .output(deploymentRetryOutputSchema)
    .build();

// ─── rollback history ────────────────────────────────────────────────────────

export const deploymentRollbackHistoryOutputSchema = z.object({
    rollbacks: z.array(deploymentRollbackSchema),
});

const deploymentRollbackHistoryOps = standard.zod(
    deploymentRollbackHistoryOutputSchema,
    "deploymentRollbackHistory",
);

export const deploymentGetRollbackHistoryContract = deploymentRollbackHistoryOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/rollbacks`))
    .output(deploymentRollbackHistoryOutputSchema)
    .build();
