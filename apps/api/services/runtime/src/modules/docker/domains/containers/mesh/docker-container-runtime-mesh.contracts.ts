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
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import type { DockerImageInspectQueryInput } from "@deployer/runtime-contracts/modules/docker/images/inspect";
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
} from "@deployer/contracts-entities";
import { contractBuilder } from "@deployer/events";


export const correlationInputSchema = z.object({
    correlationId: z.string().optional(),
});

export const containerLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
});

export const containerProcessesQuerySchema = z.object({
    containerId: z.string().min(1),
});

export const containerProcessLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
});

export const containerFilesQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1).optional(),
});

export const containerReadFileQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).max(5_000_000).optional(),
});

export const containerWriteFileBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
    createParents: z.boolean().optional(),
});

export const containerDeletePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
});

export const containerRenamePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    nextPath: z.string().min(1),
});

export const containerCreateDirectoryBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
});

export const containerTerminalOpenBodySchema = z.object({
    containerId: z.string().min(1),
    shell: z.enum(["bash", "sh", "zsh", "ash"]).optional(),
    user: z.string().min(1).optional(),
    workingDir: z.string().min(1).optional(),
});

export const containerTerminalEventsQuerySchema = z.object({
    sessionId: z.string().min(1),
    afterSequence: z.number().int().min(0).optional(),
});

export const containerTerminalInputBodySchema = z.object({
    sessionId: z.string().min(1),
    input: z.string(),
});

export const containerTerminalCloseBodySchema = z.object({
    sessionId: z.string().min(1),
});

export const imageInspectQuerySchema = z.object({
    imageId: z.string().min(1),
});

export const containerLogsSnapshotSchema = z.object({
    generatedAt: z.string(),
    entries: z.array(dockerContainerLogEntrySchema),
});

export const containerProcessesSnapshotSchema = z.object({
    generatedAt: z.string(),
    data: z.array(dockerContainerProcessEntrySchema),
});

export const containerFilesSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    entries: z.array(dockerFileEntrySchema),
});

export const containerReadFileSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    encoding: z.literal("utf8"),
    content: z.string(),
});

export const containerMutationAckSchema = z.object({
    ok: z.literal(true),
    timestamp: z.string(),
});

export const containerTerminalOpenResultSchema = z.object({
    sessionId: z.string().min(1),
    containerId: z.string().min(1),
    shell: z.enum(["bash", "sh", "zsh", "ash"]),
    user: z.string().min(1),
    workingDir: z.string().min(1),
    profiles: z.array(dockerTerminalProfileSchema),
    openedAt: z.string(),
});

export const terminalStoredEventSchema = z.object({
    sequence: z.number().int().min(1),
    sessionId: z.string().min(1),
    timestamp: z.string(),
    type: z.enum(["output", "status", "error"]),
    data: z.string(),
});

export const containerTerminalEventsSnapshotSchema = z.object({
    sessionId: z.string().min(1),
    generatedAt: z.string(),
    closed: z.boolean(),
    latestSequence: z.number().int().min(0),
    events: z.array(terminalStoredEventSchema),
});

export const logsRequestPayloadSchema = z.object({ query: containerLogsQuerySchema });
export const logsResponsePayloadSchema = z.object({
    snapshot: containerLogsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const processesRequestPayloadSchema = z.object({ query: containerProcessesQuerySchema });
export const processesResponsePayloadSchema = z.object({
    snapshot: containerProcessesSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const processLogsRequestPayloadSchema = z.object({ query: containerProcessLogsQuerySchema });
export const processLogsResponsePayloadSchema = z.object({
    snapshot: containerLogsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const filesRequestPayloadSchema = z.object({ query: containerFilesQuerySchema });
export const filesResponsePayloadSchema = z.object({
    snapshot: containerFilesSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const readFileRequestPayloadSchema = z.object({ query: containerReadFileQuerySchema });
export const readFileResponsePayloadSchema = z.object({
    snapshot: containerReadFileSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const writeFileRequestPayloadSchema = z.object({ body: containerWriteFileBodySchema });
export const writeFileResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const deletePathRequestPayloadSchema = z.object({ body: containerDeletePathBodySchema });
export const deletePathResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const renamePathRequestPayloadSchema = z.object({ body: containerRenamePathBodySchema });
export const renamePathResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const createDirectoryRequestPayloadSchema = z.object({ body: containerCreateDirectoryBodySchema });
export const createDirectoryResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const terminalOpenRequestPayloadSchema = z.object({ body: containerTerminalOpenBodySchema });
export const terminalOpenResponsePayloadSchema = z.object({
    session: containerTerminalOpenResultSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const terminalEventsRequestPayloadSchema = z.object({ query: containerTerminalEventsQuerySchema });
export const terminalEventsResponsePayloadSchema = z.object({
    snapshot: containerTerminalEventsSnapshotSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const terminalInputRequestPayloadSchema = z.object({ body: containerTerminalInputBodySchema });
export const terminalInputResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const terminalCloseRequestPayloadSchema = z.object({ body: containerTerminalCloseBodySchema });
export const terminalCloseResponsePayloadSchema = z.object({
    ack: containerMutationAckSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const imageInspectRequestPayloadSchema = z.object({ query: imageInspectQuerySchema });
export const imageInspectResponsePayloadSchema = z.object({
    detail: dockerImageInspectDetailSchema,
    responderNodeId: z.string().nullable().default(null),
});

export const cancelEnvelopeSchema = z.object({
    correlationId: z.string(),
    callerNodeId: z.string(),
    reason: z.enum(["caller_stop", "handler_stop"]),
    emittedAt: z.string(),
});

export function requestEnvelopeSchema<TPayloadSchema extends z.ZodType>(payloadSchema: TPayloadSchema) {
    return z.object({
        correlationId: z.string(),
        callerNodeId: z.string(),
        payload: payloadSchema,
        emittedAt: z.string(),
    });
}

export function responseEnvelopeSchema<TPayloadSchema extends z.ZodType>(payloadSchema: TPayloadSchema) {
    return z.object({
        correlationId: z.string(),
        responderNodeId: z.string(),
        payload: payloadSchema,
        stopPropagation: z.boolean().optional(),
        emittedAt: z.string(),
    });
}

export const dockerContainerRuntimeMeshContracts = {
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

export type DockerContainerLogsSnapshotRequestPayload = {
    query: DockerContainerLogsStreamQueryInput;
}

export type DockerContainerLogsSnapshot = {
    generatedAt: string;
    entries: DockerContainerLogEntry[];
}

export type DockerContainerLogsSnapshotResponsePayload = {
    snapshot: DockerContainerLogsSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerProcessesSnapshotRequestPayload = {
    query: DockerContainerProcessesQueryInput;
}

export type DockerContainerProcessesSnapshot = {
    generatedAt: string;
    data: DockerContainerProcessEntry[];
}

export type DockerContainerProcessesSnapshotResponsePayload = {
    snapshot: DockerContainerProcessesSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerProcessLogsSnapshotRequestPayload = {
    query: DockerContainerProcessLogsStreamQueryInput;
}

export type DockerContainerProcessLogsSnapshotResponsePayload = {
    snapshot: DockerContainerLogsSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerFilesSnapshotRequestPayload = {
    query: DockerContainerFilesQueryInput;
}

export type DockerContainerFilesSnapshot = {
    containerId: string;
    path: string;
    generatedAt: string;
    entries: DockerFileEntry[];
}

export type DockerContainerFilesSnapshotResponsePayload = {
    snapshot: DockerContainerFilesSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerReadFileSnapshotRequestPayload = {
    query: DockerContainerReadFileQueryInput;
}

export type DockerContainerReadFileSnapshot = {
    containerId: string;
    path: string;
    generatedAt: string;
    encoding: "utf8";
    content: string;
}

export type DockerContainerReadFileSnapshotResponsePayload = {
    snapshot: DockerContainerReadFileSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerWriteFileRequestPayload = {
    body: DockerContainerWriteFileBodyInput;
}

export type DockerContainerMutationAck = {
    ok: true;
    timestamp: string;
}

export type DockerContainerWriteFileResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerContainerDeletePathRequestPayload = {
    body: DockerContainerDeletePathBodyInput;
}

export type DockerContainerDeletePathResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerContainerRenamePathRequestPayload = {
    body: DockerContainerRenamePathBodyInput;
}

export type DockerContainerRenamePathResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerContainerCreateDirectoryRequestPayload = {
    body: DockerContainerCreateDirectoryBodyInput;
}

export type DockerContainerCreateDirectoryResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerContainerTerminalOpenRequestPayload = {
    body: DockerContainerTerminalOpenBodyInput;
}

export type DockerContainerTerminalOpenResult = {
    sessionId: string;
    containerId: string;
    shell: "bash" | "sh" | "zsh" | "ash";
    user: string;
    workingDir: string;
    profiles: DockerTerminalProfile[];
    openedAt: string;
}

export type DockerContainerTerminalOpenResponsePayload = {
    session: DockerContainerTerminalOpenResult;
    responderNodeId: string | null;
}

export type DockerContainerTerminalEventsRequestPayload = {
    query: {
        sessionId: string;
        afterSequence?: number;
    };
}

export type DockerContainerTerminalStoredEvent = {
    sequence: number;
    sessionId: string;
    timestamp: string;
    type: "output" | "status" | "error";
    data: string;
}

export type DockerContainerTerminalEventsSnapshot = {
    sessionId: string;
    generatedAt: string;
    closed: boolean;
    latestSequence: number;
    events: DockerContainerTerminalStoredEvent[];
}

export type DockerContainerTerminalEventsResponsePayload = {
    snapshot: DockerContainerTerminalEventsSnapshot;
    responderNodeId: string | null;
}

export type DockerContainerTerminalInputRequestPayload = {
    body: DockerContainerTerminalInputBodyInput;
}

export type DockerContainerTerminalInputResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerContainerTerminalCloseRequestPayload = {
    body: DockerContainerTerminalCloseBodyInput;
}

export type DockerContainerTerminalCloseResponsePayload = {
    ack: DockerContainerMutationAck;
    responderNodeId: string | null;
}

export type DockerImageInspectRequestPayload = {
    query: DockerImageInspectQueryInput;
}

export type DockerImageInspectResponsePayload = {
    detail: DockerImageInspectDetail;
    responderNodeId: string | null;
}
