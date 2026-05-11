import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import z from "zod/v4";
import type {
    DockerContainerCreateDirectoryBodyInput,
    DockerContainerDeletePathBodyInput,
    DockerContainerFilesQueryInput,
    DockerContainerLogsStreamQueryInput,
    DockerContainerProcessLogsStreamQueryInput,
    DockerContainerProcessesQueryInput,
    DockerContainerReadFileQueryInput,
    DockerContainerRenamePathBodyInput,
    DockerContainerTerminalCloseBodyInput,
    DockerContainerTerminalInputBodyInput,
    DockerContainerTerminalOpenBodyInput,
    DockerContainerWriteFileBodyInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import type { DockerImageInspectQueryInput } from "@repo/api-contracts/modules/docker/images/inspect";
import {
    dockerContainerLogEntrySchema,
    dockerContainerProcessEntrySchema,
    dockerFileEntrySchema,
    dockerImageInspectDetailSchema,
    dockerTerminalProfileSchema,
    type DockerContainerLogEntry,
    type DockerContainerProcessEntry,
    type DockerFileEntry,
    type DockerImageInspectDetail,
    type DockerTerminalProfile,
} from "@repo/contracts-entities";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { BaseMeshService, type MeshCallManyResult, type MeshCallManyOptions } from "@/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";

const correlationInputSchema = z.object({
    organizationId: z.string().nullable().optional(),
    correlationId: z.string().optional(),
});

const containerLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
});

const containerProcessesQuerySchema = z.object({
    containerId: z.string().min(1),
});

const containerProcessLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
});

const containerFilesQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1).optional(),
});

const containerReadFileQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).max(5_000_000).optional(),
});

const containerWriteFileBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
    createParents: z.boolean().optional(),
});

const containerDeletePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
});

const containerRenamePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    nextPath: z.string().min(1),
});

const containerCreateDirectoryBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
});

const containerTerminalOpenBodySchema = z.object({
    containerId: z.string().min(1),
    shell: z.enum(["bash", "sh", "zsh", "ash"]).optional(),
    user: z.string().min(1).optional(),
    workingDir: z.string().min(1).optional(),
});

const containerTerminalEventsQuerySchema = z.object({
    sessionId: z.string().min(1),
    afterSequence: z.number().int().min(0).optional(),
});

const containerTerminalInputBodySchema = z.object({
    sessionId: z.string().min(1),
    input: z.string(),
});

const containerTerminalCloseBodySchema = z.object({
    sessionId: z.string().min(1),
});

const imageInspectQuerySchema = z.object({
    imageId: z.string().min(1),
});

const containerLogsSnapshotSchema = z.object({
    generatedAt: z.string(),
    entries: z.array(dockerContainerLogEntrySchema),
});

const containerProcessesSnapshotSchema = z.object({
    generatedAt: z.string(),
    data: z.array(dockerContainerProcessEntrySchema),
});

const containerFilesSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    entries: z.array(dockerFileEntrySchema),
});

const containerReadFileSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    encoding: z.literal("utf8"),
    content: z.string(),
});

const containerMutationAckSchema = z.object({
    ok: z.literal(true),
    timestamp: z.string(),
});

const containerTerminalOpenResultSchema = z.object({
    sessionId: z.string().min(1),
    containerId: z.string().min(1),
    shell: z.enum(["bash", "sh", "zsh", "ash"]),
    user: z.string().min(1),
    workingDir: z.string().min(1),
    profiles: z.array(dockerTerminalProfileSchema),
    openedAt: z.string(),
});

const terminalStoredEventSchema = z.object({
    sequence: z.number().int().min(1),
    sessionId: z.string().min(1),
    timestamp: z.string(),
    type: z.enum(["output", "status", "error"]),
    data: z.string(),
});

const containerTerminalEventsSnapshotSchema = z.object({
    sessionId: z.string().min(1),
    generatedAt: z.string(),
    closed: z.boolean(),
    latestSequence: z.number().int().min(0),
    events: z.array(terminalStoredEventSchema),
});

const logsRequestPayloadSchema = z.object({ query: containerLogsQuerySchema });
const logsResponsePayloadSchema = z.object({
    snapshot: containerLogsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const processesRequestPayloadSchema = z.object({ query: containerProcessesQuerySchema });
const processesResponsePayloadSchema = z.object({
    snapshot: containerProcessesSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const processLogsRequestPayloadSchema = z.object({ query: containerProcessLogsQuerySchema });
const processLogsResponsePayloadSchema = z.object({
    snapshot: containerLogsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const filesRequestPayloadSchema = z.object({ query: containerFilesQuerySchema });
const filesResponsePayloadSchema = z.object({
    snapshot: containerFilesSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const readFileRequestPayloadSchema = z.object({ query: containerReadFileQuerySchema });
const readFileResponsePayloadSchema = z.object({
    snapshot: containerReadFileSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const writeFileRequestPayloadSchema = z.object({ body: containerWriteFileBodySchema });
const writeFileResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const deletePathRequestPayloadSchema = z.object({ body: containerDeletePathBodySchema });
const deletePathResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const renamePathRequestPayloadSchema = z.object({ body: containerRenamePathBodySchema });
const renamePathResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const createDirectoryRequestPayloadSchema = z.object({ body: containerCreateDirectoryBodySchema });
const createDirectoryResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const terminalOpenRequestPayloadSchema = z.object({ body: containerTerminalOpenBodySchema });
const terminalOpenResponsePayloadSchema = z.object({
    session: containerTerminalOpenResultSchema,
    responderNodeId: z.string().nullable().default(null),
});

const terminalEventsRequestPayloadSchema = z.object({ query: containerTerminalEventsQuerySchema });
const terminalEventsResponsePayloadSchema = z.object({
    snapshot: containerTerminalEventsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

const terminalInputRequestPayloadSchema = z.object({ body: containerTerminalInputBodySchema });
const terminalInputResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const terminalCloseRequestPayloadSchema = z.object({ body: containerTerminalCloseBodySchema });
const terminalCloseResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

const imageInspectRequestPayloadSchema = z.object({ query: imageInspectQuerySchema });
const imageInspectResponsePayloadSchema = z.object({
    detail: dockerImageInspectDetailSchema,
    responderNodeId: z.string().nullable().default(null),
});

const cancelEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    reason: z.enum(["caller_stop", "handler_stop"]),
    emittedAt: z.string(),
});

function requestEnvelopeSchema<TPayloadSchema extends z.ZodType>(payloadSchema: TPayloadSchema) {
    return z.object({
        correlationId: z.string(),
        callerNodeId: z.string(),
        payload: payloadSchema,
        emittedAt: z.string(),
    });
}

function responseEnvelopeSchema<TPayloadSchema extends z.ZodType>(payloadSchema: TPayloadSchema) {
    return z.object({
        correlationId: z.string(),
        responderNodeId: z.string(),
        payload: payloadSchema,
        stopPropagation: z.boolean().optional(),
        emittedAt: z.string(),
    });
}

const dockerContainerRuntimeMeshContracts = {
    logsSnapshotRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(logsRequestPayloadSchema))
        .build(),
    logsSnapshotResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(logsResponsePayloadSchema))
        .build(),
    logsSnapshotCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    processesSnapshotRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(processesRequestPayloadSchema))
        .build(),
    processesSnapshotResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(processesResponsePayloadSchema))
        .build(),
    processesSnapshotCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    processLogsSnapshotRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(processLogsRequestPayloadSchema))
        .build(),
    processLogsSnapshotResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(processLogsResponsePayloadSchema))
        .build(),
    processLogsSnapshotCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    filesSnapshotRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(filesRequestPayloadSchema))
        .build(),
    filesSnapshotResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(filesResponsePayloadSchema))
        .build(),
    filesSnapshotCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    readFileSnapshotRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(readFileRequestPayloadSchema))
        .build(),
    readFileSnapshotResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(readFileResponsePayloadSchema))
        .build(),
    readFileSnapshotCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    writeFileRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(writeFileRequestPayloadSchema))
        .build(),
    writeFileResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(writeFileResponsePayloadSchema))
        .build(),
    writeFileCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    deletePathRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(deletePathRequestPayloadSchema))
        .build(),
    deletePathResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(deletePathResponsePayloadSchema))
        .build(),
    deletePathCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    renamePathRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(renamePathRequestPayloadSchema))
        .build(),
    renamePathResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(renamePathResponsePayloadSchema))
        .build(),
    renamePathCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    createDirectoryRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(createDirectoryRequestPayloadSchema))
        .build(),
    createDirectoryResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(createDirectoryResponsePayloadSchema))
        .build(),
    createDirectoryCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    terminalOpenRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(terminalOpenRequestPayloadSchema))
        .build(),
    terminalOpenResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(terminalOpenResponsePayloadSchema))
        .build(),
    terminalOpenCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    terminalEventsRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(terminalEventsRequestPayloadSchema))
        .build(),
    terminalEventsResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(terminalEventsResponsePayloadSchema))
        .build(),
    terminalEventsCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    terminalInputRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(terminalInputRequestPayloadSchema))
        .build(),
    terminalInputResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(terminalInputResponsePayloadSchema))
        .build(),
    terminalInputCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    terminalCloseRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(terminalCloseRequestPayloadSchema))
        .build(),
    terminalCloseResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(terminalCloseResponsePayloadSchema))
        .build(),
    terminalCloseCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),

    imageInspectRequest: contractBuilder()
        .input(correlationInputSchema)
        .output(requestEnvelopeSchema(imageInspectRequestPayloadSchema))
        .build(),
    imageInspectResponse: contractBuilder()
        .input(correlationInputSchema)
        .output(responseEnvelopeSchema(imageInspectResponsePayloadSchema))
        .build(),
    imageInspectCancel: contractBuilder()
        .input(correlationInputSchema)
        .output(cancelEnvelopeSchema)
        .build(),
} as const;

export interface DockerContainerLogsSnapshotRequestPayload {
    query: DockerContainerLogsStreamQueryInput;
}

export interface DockerContainerLogsSnapshot {
    generatedAt: string;
    entries: DockerContainerLogEntry[];
}

export interface DockerContainerLogsSnapshotResponsePayload {
    snapshot: DockerContainerLogsSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerProcessesSnapshotRequestPayload {
    query: DockerContainerProcessesQueryInput;
}

export interface DockerContainerProcessesSnapshot {
    generatedAt: string;
    data: DockerContainerProcessEntry[];
}

export interface DockerContainerProcessesSnapshotResponsePayload {
    snapshot: DockerContainerProcessesSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerProcessLogsSnapshotRequestPayload {
    query: DockerContainerProcessLogsStreamQueryInput;
}

export interface DockerContainerProcessLogsSnapshotResponsePayload {
    snapshot: DockerContainerLogsSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerFilesSnapshotRequestPayload {
    query: DockerContainerFilesQueryInput;
}

export interface DockerContainerFilesSnapshot {
    containerId: string;
    path: string;
    generatedAt: string;
    entries: DockerFileEntry[];
}

export interface DockerContainerFilesSnapshotResponsePayload {
    snapshot: DockerContainerFilesSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerReadFileSnapshotRequestPayload {
    query: DockerContainerReadFileQueryInput;
}

export interface DockerContainerReadFileSnapshot {
    containerId: string;
    path: string;
    generatedAt: string;
    encoding: "utf8";
    content: string;
}

export interface DockerContainerReadFileSnapshotResponsePayload {
    snapshot: DockerContainerReadFileSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerWriteFileRequestPayload {
    body: DockerContainerWriteFileBodyInput;
}

export interface DockerContainerMutationAck {
    ok: true;
    timestamp: string;
}

export interface DockerContainerWriteFileResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerContainerDeletePathRequestPayload {
    body: DockerContainerDeletePathBodyInput;
}

export interface DockerContainerDeletePathResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerContainerRenamePathRequestPayload {
    body: DockerContainerRenamePathBodyInput;
}

export interface DockerContainerRenamePathResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerContainerCreateDirectoryRequestPayload {
    body: DockerContainerCreateDirectoryBodyInput;
}

export interface DockerContainerCreateDirectoryResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerContainerTerminalOpenRequestPayload {
    body: DockerContainerTerminalOpenBodyInput;
}

export interface DockerContainerTerminalOpenResult {
    sessionId: string;
    containerId: string;
    shell: "bash" | "sh" | "zsh" | "ash";
    user: string;
    workingDir: string;
    profiles: DockerTerminalProfile[];
    openedAt: string;
}

export interface DockerContainerTerminalOpenResponsePayload {
    session: DockerContainerTerminalOpenResult;
    responderNodeId: string | null;
}

export interface DockerContainerTerminalEventsRequestPayload {
    query: {
        sessionId: string;
        afterSequence?: number;
    };
}

export interface DockerContainerTerminalStoredEvent {
    sequence: number;
    sessionId: string;
    timestamp: string;
    type: "output" | "status" | "error";
    data: string;
}

export interface DockerContainerTerminalEventsSnapshot {
    sessionId: string;
    generatedAt: string;
    closed: boolean;
    latestSequence: number;
    events: DockerContainerTerminalStoredEvent[];
}

export interface DockerContainerTerminalEventsResponsePayload {
    snapshot: DockerContainerTerminalEventsSnapshot;
    responderNodeId: string | null;
}

export interface DockerContainerTerminalInputRequestPayload {
    body: DockerContainerTerminalInputBodyInput;
}

export interface DockerContainerTerminalInputResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerContainerTerminalCloseRequestPayload {
    body: DockerContainerTerminalCloseBodyInput;
}

export interface DockerContainerTerminalCloseResponsePayload {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export interface DockerImageInspectRequestPayload {
    query: DockerImageInspectQueryInput;
}

export interface DockerImageInspectResponsePayload {
    detail: DockerImageInspectDetail;
    responderNodeId: string | null;
}

@Injectable()
export class DockerContainerRuntimeMeshService
    extends BaseMeshService<typeof dockerContainerRuntimeMeshContracts>
    implements OnModuleInit, OnModuleDestroy {
    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        super(meshTopicService, meshTopologyService, "docker-container-runtime-internal", dockerContainerRuntimeMeshContracts);
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();
    }

    onModuleDestroy(): void {
        this.teardownMeshNamespace();
    }

    registerLogsSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerLogsSnapshotRequestPayload }) =>
            | { payload: DockerContainerLogsSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerLogsSnapshotResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("logsSnapshotRequest", "logsSnapshotResponse", "logsSnapshotCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerProcessesSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerProcessesSnapshotRequestPayload }) =>
            | { payload: DockerContainerProcessesSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerProcessesSnapshotResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("processesSnapshotRequest", "processesSnapshotResponse", "processesSnapshotCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerProcessLogsSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerProcessLogsSnapshotRequestPayload }) =>
            | { payload: DockerContainerProcessLogsSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerProcessLogsSnapshotResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("processLogsSnapshotRequest", "processLogsSnapshotResponse", "processLogsSnapshotCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerFilesSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerFilesSnapshotRequestPayload }) =>
            | { payload: DockerContainerFilesSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerFilesSnapshotResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("filesSnapshotRequest", "filesSnapshotResponse", "filesSnapshotCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerReadFileSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerReadFileSnapshotRequestPayload }) =>
            | { payload: DockerContainerReadFileSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerReadFileSnapshotResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("readFileSnapshotRequest", "readFileSnapshotResponse", "readFileSnapshotCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerWriteFileHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerWriteFileRequestPayload }) =>
            | { payload: DockerContainerWriteFileResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerWriteFileResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("writeFileRequest", "writeFileResponse", "writeFileCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerDeletePathHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerDeletePathRequestPayload }) =>
            | { payload: DockerContainerDeletePathResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerDeletePathResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("deletePathRequest", "deletePathResponse", "deletePathCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerRenamePathHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerRenamePathRequestPayload }) =>
            | { payload: DockerContainerRenamePathResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerRenamePathResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("renamePathRequest", "renamePathResponse", "renamePathCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerCreateDirectoryHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerCreateDirectoryRequestPayload }) =>
            | { payload: DockerContainerCreateDirectoryResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerCreateDirectoryResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("createDirectoryRequest", "createDirectoryResponse", "createDirectoryCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerTerminalOpenHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalOpenRequestPayload }) =>
            | { payload: DockerContainerTerminalOpenResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalOpenResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("terminalOpenRequest", "terminalOpenResponse", "terminalOpenCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerTerminalEventsHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalEventsRequestPayload }) =>
            | { payload: DockerContainerTerminalEventsResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalEventsResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("terminalEventsRequest", "terminalEventsResponse", "terminalEventsCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerTerminalInputHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalInputRequestPayload }) =>
            | { payload: DockerContainerTerminalInputResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalInputResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("terminalInputRequest", "terminalInputResponse", "terminalInputCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerTerminalCloseHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalCloseRequestPayload }) =>
            | { payload: DockerContainerTerminalCloseResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalCloseResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("terminalCloseRequest", "terminalCloseResponse", "terminalCloseCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    registerImageInspectHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerImageInspectRequestPayload }) =>
            | { payload: DockerImageInspectResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerImageInspectResponsePayload; stopPropagation?: boolean }>,
        options?: { organizationId?: string | null },
    ): void {
        this.registerCallHandler("imageInspectRequest", "imageInspectResponse", "imageInspectCancel", {
            organizationId: options?.organizationId ?? null,
        }, handler);
    }

    listContainerLogsSnapshotAcrossInstances(
        payload: DockerContainerLogsSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerLogsSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerLogsSnapshotResponsePayload>> {
        return this.callMany("logsSnapshotRequest", "logsSnapshotResponse", "logsSnapshotCancel", payload, options);
    }

    listContainerProcessesSnapshotAcrossInstances(
        payload: DockerContainerProcessesSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerProcessesSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerProcessesSnapshotResponsePayload>> {
        return this.callMany("processesSnapshotRequest", "processesSnapshotResponse", "processesSnapshotCancel", payload, options);
    }

    listContainerProcessLogsSnapshotAcrossInstances(
        payload: DockerContainerProcessLogsSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerProcessLogsSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerProcessLogsSnapshotResponsePayload>> {
        return this.callMany("processLogsSnapshotRequest", "processLogsSnapshotResponse", "processLogsSnapshotCancel", payload, options);
    }

    listContainerFilesSnapshotAcrossInstances(
        payload: DockerContainerFilesSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerFilesSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerFilesSnapshotResponsePayload>> {
        return this.callMany("filesSnapshotRequest", "filesSnapshotResponse", "filesSnapshotCancel", payload, options);
    }

    readContainerFileSnapshotAcrossInstances(
        payload: DockerContainerReadFileSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerReadFileSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerReadFileSnapshotResponsePayload>> {
        return this.callMany("readFileSnapshotRequest", "readFileSnapshotResponse", "readFileSnapshotCancel", payload, options);
    }

    writeContainerFileAcrossInstances(
        payload: DockerContainerWriteFileRequestPayload,
        options?: MeshCallManyOptions<DockerContainerWriteFileResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerWriteFileResponsePayload>> {
        return this.callMany("writeFileRequest", "writeFileResponse", "writeFileCancel", payload, options);
    }

    deleteContainerPathAcrossInstances(
        payload: DockerContainerDeletePathRequestPayload,
        options?: MeshCallManyOptions<DockerContainerDeletePathResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerDeletePathResponsePayload>> {
        return this.callMany("deletePathRequest", "deletePathResponse", "deletePathCancel", payload, options);
    }

    renameContainerPathAcrossInstances(
        payload: DockerContainerRenamePathRequestPayload,
        options?: MeshCallManyOptions<DockerContainerRenamePathResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerRenamePathResponsePayload>> {
        return this.callMany("renamePathRequest", "renamePathResponse", "renamePathCancel", payload, options);
    }

    createContainerDirectoryAcrossInstances(
        payload: DockerContainerCreateDirectoryRequestPayload,
        options?: MeshCallManyOptions<DockerContainerCreateDirectoryResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerCreateDirectoryResponsePayload>> {
        return this.callMany("createDirectoryRequest", "createDirectoryResponse", "createDirectoryCancel", payload, options);
    }

    openContainerTerminalSessionAcrossInstances(
        payload: DockerContainerTerminalOpenRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalOpenResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalOpenResponsePayload>> {
        return this.callMany("terminalOpenRequest", "terminalOpenResponse", "terminalOpenCancel", payload, options);
    }

    listContainerTerminalSessionEventsAcrossInstances(
        payload: DockerContainerTerminalEventsRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalEventsResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalEventsResponsePayload>> {
        return this.callMany("terminalEventsRequest", "terminalEventsResponse", "terminalEventsCancel", payload, options);
    }

    sendContainerTerminalInputAcrossInstances(
        payload: DockerContainerTerminalInputRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalInputResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalInputResponsePayload>> {
        return this.callMany("terminalInputRequest", "terminalInputResponse", "terminalInputCancel", payload, options);
    }

    closeContainerTerminalSessionAcrossInstances(
        payload: DockerContainerTerminalCloseRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalCloseResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalCloseResponsePayload>> {
        return this.callMany("terminalCloseRequest", "terminalCloseResponse", "terminalCloseCancel", payload, options);
    }

    inspectImageAcrossInstances(
        payload: DockerImageInspectRequestPayload,
        options?: MeshCallManyOptions<DockerImageInspectResponsePayload>,
    ): Promise<MeshCallManyResult<DockerImageInspectResponsePayload>> {
        return this.callMany("imageInspectRequest", "imageInspectResponse", "imageInspectCancel", payload, options);
    }
}
