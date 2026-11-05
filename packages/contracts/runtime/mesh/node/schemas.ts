import z from 'zod/v4'

import {
    dockerContainerInspectDetailSchema,
    dockerContainerLogEntrySchema,
    dockerContainerProcessEntrySchema,
    dockerContainerSchema,
    dockerFileEntrySchema,
    dockerImageInspectDetailSchema,
    dockerRuntimeCatalogSchema,
    dockerTerminalProfileSchema,
} from '@deployer/contracts-entities'

/**
 * What one node answers about its own docker engine. Every procedure of the node router takes its query or body as its
 * input and answers its snapshot or acknowledgement as its output: there is no envelope, no correlation id and no
 * responder, because the call is pinned to a node by the mesh and the answer needs no signature to say whose it is.
 */

export const dockerContainerListQuerySchema = z.object({
    limit: z.number().int().min(1).max(500),
    offset: z.number().int().min(0),
    sortBy: z.string().optional(),
    sortDirection: z.enum(['asc', 'desc']).optional(),
    filter: z.record(z.string(), z.unknown()).optional(),
})

export const dockerContainerListMetaSchema = z.object({
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
    hasMore: z.boolean(),
})

/** A page of this node's containers, with the id of the docker daemon that answered. */
export const dockerContainerListResponseSchema = z.object({
    data: z.array(dockerContainerSchema),
    meta: dockerContainerListMetaSchema,
    daemonId: z.string().nullable(),
})

export const dockerContainerInspectQuerySchema = z.object({
    containerId: z.string().min(1),
})

export const dockerContainerInspectResponseSchema = z.object({
    detail: dockerContainerInspectDetailSchema,
})

export const dockerRuntimeCatalogResponseSchema = z.object({
    catalog: dockerRuntimeCatalogSchema,
})

export const containerLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
})

export const containerProcessesQuerySchema = z.object({
    containerId: z.string().min(1),
})

export const containerProcessLogsQuerySchema = z.object({
    containerId: z.string().min(1),
    pid: z.number().int().nonnegative(),
    tail: z.number().int().min(1).max(5_000).optional(),
    refreshIntervalMs: z.number().int().min(400).max(30_000).optional(),
})

export const containerFilesQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1).optional(),
})

export const containerReadFileQuerySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).max(5_000_000).optional(),
})

export const containerWriteFileBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    content: z.string(),
    createParents: z.boolean().optional(),
})

export const containerDeletePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
})

export const containerRenamePathBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    nextPath: z.string().min(1),
})

export const containerCreateDirectoryBodySchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
})

export const containerTerminalOpenBodySchema = z.object({
    containerId: z.string().min(1),
    shell: z.enum(['bash', 'sh', 'zsh', 'ash']).optional(),
    user: z.string().min(1).optional(),
    workingDir: z.string().min(1).optional(),
})

export const containerTerminalEventsQuerySchema = z.object({
    sessionId: z.string().min(1),
    afterSequence: z.number().int().min(0).optional(),
})

export const containerTerminalInputBodySchema = z.object({
    sessionId: z.string().min(1),
    input: z.string(),
})

export const containerTerminalCloseBodySchema = z.object({
    sessionId: z.string().min(1),
})

export const imageInspectQuerySchema = z.object({
    imageId: z.string().min(1),
})

export const containerLogsSnapshotSchema = z.object({
    generatedAt: z.string(),
    entries: z.array(dockerContainerLogEntrySchema),
})

export const containerProcessesSnapshotSchema = z.object({
    generatedAt: z.string(),
    data: z.array(dockerContainerProcessEntrySchema),
})

export const containerFilesSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    entries: z.array(dockerFileEntrySchema),
})

export const containerReadFileSnapshotSchema = z.object({
    containerId: z.string().min(1),
    path: z.string().min(1),
    generatedAt: z.string(),
    encoding: z.literal('utf8'),
    content: z.string(),
})

export const containerMutationAckSchema = z.object({
    ok: z.literal(true),
    timestamp: z.string(),
})

export const containerTerminalOpenResultSchema = z.object({
    sessionId: z.string().min(1),
    containerId: z.string().min(1),
    shell: z.enum(['bash', 'sh', 'zsh', 'ash']),
    user: z.string().min(1),
    workingDir: z.string().min(1),
    profiles: z.array(dockerTerminalProfileSchema),
    openedAt: z.string(),
})

export const terminalStoredEventSchema = z.object({
    sequence: z.number().int().min(1),
    sessionId: z.string().min(1),
    timestamp: z.string(),
    type: z.enum(['output', 'status', 'error']),
    data: z.string(),
})

export const containerTerminalEventsSnapshotSchema = z.object({
    sessionId: z.string().min(1),
    generatedAt: z.string(),
    closed: z.boolean(),
    latestSequence: z.number().int().min(0),
    events: z.array(terminalStoredEventSchema),
})

export { dockerImageInspectDetailSchema }

/** Following a node's events takes no parameters: it is every event of the node, from now. */
export const dockerRuntimeEventsStreamQuerySchema = z.object({})
