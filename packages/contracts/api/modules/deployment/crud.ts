import * as z from "zod";
import { standard } from "@repo/orpc-utils";
import { route } from "@repo/orpc-utils/builder";
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

export const deploymentTriggerContract = route({
    method: "POST",
    path: "/trigger",
    summary: "Trigger a new deployment",
})
    .input((b) => b.body(deploymentTriggerInputSchema))
    .output(
        z.object({
            deploymentId: z.uuid(),
            status: deploymentStatusSchema,
            message: z.string(),
        }),
    )
    .build();

// ─── upload bundle ────────────────────────────────────────────────────────────

export const deploymentUploadBundleContract = route({
    method: "POST",
    path: "/upload-bundle",
    summary: "Upload a deployment bundle archive",
})
    .input((b) =>
        b.body(
            z.object({
                file: z.file(),
                fileName: z.string().min(1).optional(),
            }),
        ),
    )
    .output(
        z.object({
            uploadId: z.string().min(1),
            uploadPath: z.string().min(1),
            fileName: z.string().min(1),
            fileSize: z.number().int().nonnegative(),
            mimeType: z.string().min(1),
        }),
    )
    .build();

// ─── cancel ──────────────────────────────────────────────────────────────────

export const deploymentCancelContract = route({
    method: "POST",
    path: "/{id}/cancel",
    summary: "Cancel a running deployment",
})
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/cancel`)
            .body(z.object({ reason: z.string().optional() })),
    )
    .output(
        z.object({
            success: z.boolean(),
            message: z.string(),
            deploymentId: z.uuid(),
            cancelledAt: z.string(),
        }),
    )
    .build();

// ─── rollback ────────────────────────────────────────────────────────────────

export const deploymentRollbackContract = route({
    method: "POST",
    path: "/{id}/rollback",
    summary: "Roll back to a previous successful deployment",
})
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
    .output(
        z.object({
            rollbackDeploymentId: z.uuid(),
            message: z.string(),
        }),
    )
    .build();

// ─── getLogs ─────────────────────────────────────────────────────────────────

export const deploymentGetLogsContract = route({
    method: "GET",
    path: "/{id}/logs",
    summary: "Get deployment logs with pagination",
})
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
    .output(
        z.object({
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
        }),
    )
    .build();

// ─── retry ───────────────────────────────────────────────────────────────────

export const deploymentRetryContract = route({
    method: "POST",
    path: "/{id}/retry",
    summary: "Retry a failed or cancelled deployment with the same config",
})
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/retry`))
    .output(
        z.object({
            retryDeploymentId: z.uuid(),
            message: z.string(),
        }),
    )
    .build();

// ─── rollback history ────────────────────────────────────────────────────────

export const deploymentGetRollbackHistoryContract = route({
    method: "GET",
    path: "/{id}/rollbacks",
    summary: "Get rollback history for a deployment",
})
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/rollbacks`))
    .output(
        z.object({
            rollbacks: z.array(deploymentRollbackSchema),
        }),
    )
    .build();
