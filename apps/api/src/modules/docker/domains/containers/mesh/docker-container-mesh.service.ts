import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import z from "zod/v4";
import type { DockerContainerInspectQueryInput, DockerContainerListInput } from "@repo/api-contracts/modules/docker/containers/shared";
import {
    dockerContainerInspectDetailSchema,
    dockerRuntimeCatalogSchema,
    dockerContainerSchema,
    type DockerContainer,
    type DockerContainerInspectDetail,
    type DockerRuntimeCatalog,
} from "@repo/contracts-entities";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { BaseMeshService, type MeshCallManyResult } from "@/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";

const dockerContainerListQuerySchema = z.object({
    limit: z.number().int().min(1).max(500),
    offset: z.number().int().min(0),
    sortBy: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
});

const dockerContainerListMetaSchema = z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
});

const dockerContainerListResponsePayloadSchema = z.object({
    data: z.array(dockerContainerSchema),
    meta: dockerContainerListMetaSchema,
    responderNodeId: z.string().nullable().default(null),
    responderDaemonId: z.string().nullable().default(null),
});

const dockerContainerInspectQuerySchema = z.object({
    containerId: z.string().min(1),
});

const dockerContainerInspectResponsePayloadSchema = z.object({
    detail: dockerContainerInspectDetailSchema,
    responderNodeId: z.string().nullable().default(null),
});

const requestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({ query: dockerContainerListQuerySchema }),
    emittedAt: z.string(),
});

const inspectRequestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({ query: dockerContainerInspectQuerySchema }),
    emittedAt: z.string(),
});

const runtimeCatalogRequestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({}),
    emittedAt: z.string(),
});

const responseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: dockerContainerListResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

const inspectResponseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: dockerContainerInspectResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

const runtimeCatalogResponsePayloadSchema = z.object({
    catalog: dockerRuntimeCatalogSchema,
    responderNodeId: z.string().nullable().default(null),
});

const runtimeCatalogResponseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: runtimeCatalogResponsePayloadSchema,
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

const dockerContainerMeshContracts = {
    listContainersRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema)
        .build(),
    listContainersResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema)
        .build(),
    listContainersCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
    inspectContainerRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(inspectRequestEnvelopeSchema)
        .build(),
    inspectContainerResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(inspectResponseEnvelopeSchema)
        .build(),
    inspectContainerCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
    runtimeCatalogRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(runtimeCatalogRequestEnvelopeSchema)
        .build(),
    runtimeCatalogResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(runtimeCatalogResponseEnvelopeSchema)
        .build(),
    runtimeCatalogCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
} as const;

export interface DockerContainerListMeta {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

export interface DockerContainerListResult {
    data: DockerContainer[];
    meta: DockerContainerListMeta;
}

export interface DockerContainerListRequestPayload {
    query: DockerContainerListInput;
}

export interface DockerContainerInspectRequestPayload {
    query: DockerContainerInspectQueryInput;
}

export interface DockerContainerListResponsePayload {
    data: DockerContainer[];
    meta: DockerContainerListMeta;
    responderNodeId: string | null;
    responderDaemonId: string | null;
}

export interface DockerContainerInspectResponsePayload {
    detail: DockerContainerInspectDetail;
    responderNodeId: string | null;
}

export type DockerRuntimeCatalogRequestPayload = Record<string, never>;

export interface DockerRuntimeCatalogResponsePayload {
    catalog: DockerRuntimeCatalog;
    responderNodeId: string | null;
}

@Injectable()
export class DockerContainerMeshService
    extends BaseMeshService<typeof dockerContainerMeshContracts>
    implements OnModuleInit, OnModuleDestroy {
    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        super(meshTopicService, meshTopologyService, "docker-container-internal", dockerContainerMeshContracts);
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();
    }

    onModuleDestroy(): void {
        this.teardownMeshNamespace();
    }

    registerListContainersHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerContainerListRequestPayload;
        }) =>
            | { payload: DockerContainerListResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerListResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "listContainersRequest",
            "listContainersResponse",
            "listContainersCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    registerInspectContainerHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerContainerInspectRequestPayload;
        }) =>
            | { payload: DockerContainerInspectResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerInspectResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "inspectContainerRequest",
            "inspectContainerResponse",
            "inspectContainerCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    registerRuntimeCatalogHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerRuntimeCatalogRequestPayload;
        }) =>
            | { payload: DockerRuntimeCatalogResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerRuntimeCatalogResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler(
            "runtimeCatalogRequest",
            "runtimeCatalogResponse",
            "runtimeCatalogCancel",
            { organizationId: options?.organizationId ?? null },
            handler,
        );
    }

    listContainersAcrossInstances(
        payload: DockerContainerListRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerContainerListResponsePayload>> {
        return this.callMany(
            "listContainersRequest",
            "listContainersResponse",
            "listContainersCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 1_500,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }

    inspectContainerAcrossInstances(
        payload: DockerContainerInspectRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerContainerInspectResponsePayload>> {
        return this.callMany(
            "inspectContainerRequest",
            "inspectContainerResponse",
            "inspectContainerCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 1_500,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }

    listRuntimeCatalogAcrossInstances(
        payload: DockerRuntimeCatalogRequestPayload,
        options?: {
            organizationId?: string | null;
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerRuntimeCatalogResponsePayload>> {
        return this.callMany(
            "runtimeCatalogRequest",
            "runtimeCatalogResponse",
            "runtimeCatalogCancel",
            payload,
            {
                organizationId: options?.organizationId ?? null,
                timeoutMs: options?.timeoutMs ?? 2_000,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }
}