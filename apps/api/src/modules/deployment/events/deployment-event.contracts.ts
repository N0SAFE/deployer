import * as z from "zod";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import {
    deploymentStatusSchema,
    deploymentPhaseSchema,
    deploymentLogSchema,
    deploymentSchema,
} from "@repo/api-contracts/common/deployment";

export const deploymentEventContracts = {
    deploymentTriggered: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                deployment: deploymentSchema,
                timestamp: z.string(),
            }),
        )
        .build(),

    serviceStatusChanged: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                deploymentId: z.string(),
                status: deploymentStatusSchema,
                timestamp: z.string(),
            }),
        )
        .build(),

    statusChanged: contractBuilder()
        .input(z.object({ deploymentId: z.string() }))
        .output(
            z.object({
                deploymentId: z.string(),
                status: deploymentStatusSchema,
                previousStatus: deploymentStatusSchema.nullable(),
                phase: deploymentPhaseSchema.nullable().optional(),
                timestamp: z.string(),
            }),
        )
        .build(),

    phaseUpdated: contractBuilder()
        .input(z.object({ deploymentId: z.string() }))
        .output(
            z.object({
                deploymentId: z.string(),
                phase: deploymentPhaseSchema,
                progress: z.number().int().min(0).max(100),
                timestamp: z.string(),
            }),
        )
        .build(),

    logAppended: contractBuilder()
        .input(z.object({ deploymentId: z.string() }))
        .output(deploymentLogSchema)
        .build(),

    rollbackStarted: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                fromDeploymentId: z.string(),
                toDeploymentId: z.string(),
                timestamp: z.string(),
            }),
        )
        .build(),

    rollbackCompleted: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                fromDeploymentId: z.string(),
                toDeploymentId: z.string(),
                success: z.boolean(),
                timestamp: z.string(),
            }),
        )
        .build(),

    orchestrationPhaseTransition: contractBuilder()
        .input(z.object({ deploymentId: z.string() }))
        .output(
            z.object({
                deploymentId: z.string(),
                fromPhase: deploymentPhaseSchema.optional(),
                toPhase: deploymentPhaseSchema,
                progress: z.number().int().min(0).max(100),
                timestamp: z.string(),
            }),
        )
        .build(),

    healthCheckUpdated: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                deploymentId: z.string().optional(),
                status: z.enum(["healthy", "degraded", "unhealthy"]),
                message: z.string().optional(),
                timestamp: z.string(),
            }),
        )
        .build(),

    domainRouteUpdated: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                projectId: z.string().optional(),
                domain: z.string(),
                action: z.enum(["created", "updated", "deleted", "synced"]),
                timestamp: z.string(),
            }),
        )
        .build(),

    metricsSnapshot: contractBuilder()
        .input(z.object({ deploymentId: z.string() }))
        .output(
            z.object({
                deploymentId: z.string(),
                cpuPercent: z.number().min(0).max(100).optional(),
                memoryMb: z.number().nonnegative().optional(),
                networkRxBytes: z.number().nonnegative().optional(),
                networkTxBytes: z.number().nonnegative().optional(),
                timestamp: z.string(),
            }),
        )
        .build(),

    deploymentCancelled: contractBuilder()
        .input(z.object({ serviceId: z.string() }))
        .output(
            z.object({
                serviceId: z.string(),
                deploymentId: z.string(),
                reason: z.string().optional(),
                timestamp: z.string(),
            }),
        )
        .build(),
} as const;

export type DeploymentEventContracts = typeof deploymentEventContracts;
