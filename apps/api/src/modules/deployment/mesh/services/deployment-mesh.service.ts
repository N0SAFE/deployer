import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import * as z from "zod";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { BaseMeshService, type MeshCallManyResult } from "@/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";

const resolveDeploymentRequestPayloadSchema = z.object({
    deploymentId: z.string(),
    key: z.string().min(1),
});

const resolveDeploymentResponsePayloadSchema = z.object({
    found: z.boolean(),
    ownerNodeId: z.string().nullable().default(null),
    ownerServerUrl: z.url().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});

const deploymentSummarySchema = z.object({
    deploymentId: z.string(),
    serviceId: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    environment: z.string().nullable().default(null),
    ownerNodeId: z.string().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});

const searchDeploymentsRequestPayloadSchema = z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(200).default(25),
});

const searchDeploymentsResponsePayloadSchema = z.object({
    items: z.array(deploymentSummarySchema),
    total: z.number().int().min(0).default(0),
});

const listDeploymentsRequestPayloadSchema = z.object({
    serviceId: z.string().optional(),
    projectId: z.string().optional(),
    status: z.string().optional(),
    environment: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(100),
});

const listDeploymentsResponsePayloadSchema = z.object({
    items: z.array(deploymentSummarySchema),
    total: z.number().int().min(0).default(0),
});

const requestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: resolveDeploymentRequestPayloadSchema,
    emittedAt: z.string(),
});

const responseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: resolveDeploymentResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

const cancelEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    reason: z.enum(["caller_stop", "handler_stop"]),
    emittedAt: z.string(),
});

const correlationInputSchema = z.object({
    organizationId: z.string().nullable().optional(),
    correlationId: z.string().optional(),
});

const deploymentMeshContracts = {
    resolveDeploymentRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema)
        .build(),
    resolveDeploymentResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema)
        .build(),
    resolveDeploymentCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
    searchDeploymentsRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(
            requestEnvelopeSchema.extend({
                payload: searchDeploymentsRequestPayloadSchema,
            }),
        )
        .build(),
    searchDeploymentsResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(
            responseEnvelopeSchema.extend({
                payload: searchDeploymentsResponsePayloadSchema,
            }),
        )
        .build(),
    searchDeploymentsCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
    listDeploymentsRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(
            requestEnvelopeSchema.extend({
                payload: listDeploymentsRequestPayloadSchema,
            }),
        )
        .build(),
    listDeploymentsResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(
            responseEnvelopeSchema.extend({
                payload: listDeploymentsResponsePayloadSchema,
            }),
        )
        .build(),
    listDeploymentsCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
} as const;

export type ResolveDeploymentRequestPayload = z.infer<typeof resolveDeploymentRequestPayloadSchema>;
export type ResolveDeploymentResponsePayload = z.infer<typeof resolveDeploymentResponsePayloadSchema>;
export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;
export type SearchDeploymentsRequestPayload = z.infer<typeof searchDeploymentsRequestPayloadSchema>;
export type SearchDeploymentsResponsePayload = z.infer<typeof searchDeploymentsResponsePayloadSchema>;
export type ListDeploymentsRequestPayload = z.infer<typeof listDeploymentsRequestPayloadSchema>;
export type ListDeploymentsResponsePayload = z.infer<typeof listDeploymentsResponsePayloadSchema>;

@Injectable()
export class DeploymentMeshService extends BaseMeshService<typeof deploymentMeshContracts> implements OnModuleInit, OnModuleDestroy {
    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        super(meshTopicService, meshTopologyService, "deployment-internal", deploymentMeshContracts);
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();
    }

    onModuleDestroy(): void {
        this.teardownMeshNamespace();
    }

    registerResolveDeploymentHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: ResolveDeploymentRequestPayload;
        }) =>
            | { payload: ResolveDeploymentResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: ResolveDeploymentResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "resolveDeploymentRequest",
            "resolveDeploymentResponse",
            "resolveDeploymentCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    resolveDeploymentAcrossInstances(
        payload: ResolveDeploymentRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
            stopOnFirstFound?: boolean;
        },
    ): Promise<MeshCallManyResult<ResolveDeploymentResponsePayload>> {
        return this.callMany(
            "resolveDeploymentRequest",
            "resolveDeploymentResponse",
            "resolveDeploymentCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 1_500,
                stopWhen: options?.stopOnFirstFound
                    ? (response) => response.found
                    : undefined,
            },
        );
    }

    registerSearchDeploymentsHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: SearchDeploymentsRequestPayload;
        }) =>
            | { payload: SearchDeploymentsResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: SearchDeploymentsResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "searchDeploymentsRequest",
            "searchDeploymentsResponse",
            "searchDeploymentsCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    registerListDeploymentsHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: ListDeploymentsRequestPayload;
        }) =>
            | { payload: ListDeploymentsResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: ListDeploymentsResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "listDeploymentsRequest",
            "listDeploymentsResponse",
            "listDeploymentsCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    async searchDeploymentsAcrossInstances(
        payload: SearchDeploymentsRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
            stopOnFirstMatch?: boolean;
        },
    ): Promise<{ items: DeploymentSummary[]; total: number; stoppedEarly: boolean }> {
        const result = await this.callMany<
            "searchDeploymentsRequest",
            "searchDeploymentsResponse",
            "searchDeploymentsCancel",
            SearchDeploymentsRequestPayload,
            SearchDeploymentsResponsePayload
        >(
            "searchDeploymentsRequest",
            "searchDeploymentsResponse",
            "searchDeploymentsCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 1_500,
                stopWhen: options?.stopOnFirstMatch
                    ? (response) => response.items.length > 0
                    : undefined,
            },
        );

        const merged = this.mergeDeploymentItems(result.responses.flatMap((response) => response.items));
        const limited = merged.slice(0, payload.limit);

        return {
            items: limited,
            total: merged.length,
            stoppedEarly: result.stoppedEarly,
        };
    }

    async listDeploymentsAcrossInstances(
        payload: ListDeploymentsRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
        },
    ): Promise<{ items: DeploymentSummary[]; total: number }> {
        const result = await this.callMany<
            "listDeploymentsRequest",
            "listDeploymentsResponse",
            "listDeploymentsCancel",
            ListDeploymentsRequestPayload,
            ListDeploymentsResponsePayload
        >(
            "listDeploymentsRequest",
            "listDeploymentsResponse",
            "listDeploymentsCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 1_500,
            },
        );

        const merged = this.mergeDeploymentItems(result.responses.flatMap((response) => response.items));
        const limited = merged.slice(0, payload.limit);

        return {
            items: limited,
            total: merged.length,
        };
    }

    private mergeDeploymentItems(items: DeploymentSummary[]): DeploymentSummary[] {
        const byDeploymentId = new Map<string, DeploymentSummary>();
        for (const item of items) {
            const existing = byDeploymentId.get(item.deploymentId);
            if (!existing) {
                byDeploymentId.set(item.deploymentId, item);
                continue;
            }

            byDeploymentId.set(item.deploymentId, {
                ...existing,
                ...item,
                metadata: {
                    ...(existing.metadata ?? {}),
                    ...(item.metadata ?? {}),
                },
            });
        }

        return [...byDeploymentId.values()];
    }
}
