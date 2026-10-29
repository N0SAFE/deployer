import z from "zod/v4";
import type { DockerContainerInspectQueryInput, DockerContainerListInput } from "@deployer/runtime-contracts/modules/docker/containers/shared";
import {
    dockerContainerInspectDetailSchema,
    dockerRuntimeCatalogSchema,
    dockerContainerSchema,
    type DockerContainer,
    type DockerContainerInspectDetail,
    type DockerRuntimeCatalog,
} from "@deployer/contracts-entities";
import { contractBuilder } from "@deployer/events";


export const dockerContainerListQuerySchema = z.object({
    limit: z.number().int().min(1).max(500),
    offset: z.number().int().min(0),
    sortBy: z.string().optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
});

export const dockerContainerListMetaSchema = z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
});

export const dockerContainerListResponsePayloadSchema = z.object({
    data: z.array(dockerContainerSchema),
    meta: dockerContainerListMetaSchema,
    responderNodeId: z.string().nullable().default(null),
    responderDaemonId: z.string().nullable().default(null),
});

export const dockerContainerInspectQuerySchema = z.object({
    containerId: z.string().min(1),
});

export const dockerContainerInspectResponsePayloadSchema = z.object({
    detail: dockerContainerInspectDetailSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const requestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({ query: dockerContainerListQuerySchema }),
    emittedAt: z.string(),
});

export const inspectRequestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({ query: dockerContainerInspectQuerySchema }),
    emittedAt: z.string(),
});

export const runtimeCatalogRequestEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    payload: z.object({}),
    emittedAt: z.string(),
});

export const responseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: dockerContainerListResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

export const inspectResponseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: dockerContainerInspectResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

export const runtimeCatalogResponsePayloadSchema = z.object({
    catalog: dockerRuntimeCatalogSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const runtimeCatalogResponseEnvelopeSchema = z.object({
    correlationId: z.string(),
    responderNodeId: z.string(),
    payload: runtimeCatalogResponsePayloadSchema,
    stopPropagation: z.boolean().optional(),
    emittedAt: z.string(),
});

export const cancelEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    reason: z.enum(["caller_stop", "handler_stop"]),
    emittedAt: z.string(),
});

export const correlationInputSchema = z.object({
    correlationId: z.string().optional(),
});

export const dockerContainerMeshContracts = {
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

export type DockerContainerListMeta = {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

export type DockerContainerListResult = {
    data: DockerContainer[];
    meta: DockerContainerListMeta;
}

export type DockerContainerListRequestPayload = {
    query: DockerContainerListInput;
}

export type DockerContainerInspectRequestPayload = {
    query: DockerContainerInspectQueryInput;
}

export type DockerContainerListResponsePayload = {
    data: DockerContainer[];
    meta: DockerContainerListMeta;
    responderNodeId: string | null;
    responderDaemonId: string | null;
}

export type DockerContainerInspectResponsePayload = {
    detail: DockerContainerInspectDetail;
    responderNodeId: string | null;
}

export type DockerRuntimeCatalogRequestPayload = Record<string, never>;

export type DockerRuntimeCatalogResponsePayload = {
    catalog: DockerRuntimeCatalog;
    responderNodeId: string | null;
}
