import type {
    DockerContainer,
    DockerContainerInspectDetail,
    DockerContainerLogEntry,
    DockerContainerProcessEntry,
    DockerFileEntry,
    DockerImageInspectDetail,
    DockerRuntimeCatalog,
    DockerTerminalProfile,
} from '@deployer/contracts-entities'
import type {
    DockerContainerInspectQueryInput,
    DockerContainerListInput,
} from '@deployer/runtime-contracts/modules/docker/containers/shared'
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
} from '@deployer/runtime-contracts/modules/docker/containers/shared'
import type { DockerImageInspectQueryInput } from '@deployer/runtime-contracts/modules/docker/images/inspect'

/**
 * What a node's answer looks like to the code that asks the whole mesh: the payload of one responder, named by the node
 * that produced it. The node router answers without an envelope; `DockerNodeMesh` wraps each answer in these shapes so
 * the callers that merge, dedupe and fall back across nodes keep reading what they always read.
 */
export type DockerContainerListMeta = {
    total: number
    limit: number
    offset: number
    hasMore: boolean
}

export type DockerContainerListResult = {
    data: DockerContainer[]
    meta: DockerContainerListMeta
}

export type DockerContainerListRequestPayload = {
    query: DockerContainerListInput
}

export type DockerContainerInspectRequestPayload = {
    query: DockerContainerInspectQueryInput
}

export type DockerContainerListResponsePayload = {
    data: DockerContainer[]
    meta: DockerContainerListMeta
    responderNodeId: string | null
    responderDaemonId: string | null
}

export type DockerContainerInspectResponsePayload = {
    detail: DockerContainerInspectDetail
    responderNodeId: string | null
}

export type DockerRuntimeCatalogRequestPayload = Record<string, never>

export type DockerRuntimeCatalogResponsePayload = {
    catalog: DockerRuntimeCatalog
    responderNodeId: string | null
}

export type DockerContainerLogsSnapshotRequestPayload = {
    query: DockerContainerLogsStreamQueryInput
}

export type DockerContainerLogsSnapshot = {
    generatedAt: string
    entries: DockerContainerLogEntry[]
}

export type DockerContainerLogsSnapshotResponsePayload = {
    snapshot: DockerContainerLogsSnapshot
    responderNodeId: string | null
}

export type DockerContainerProcessesSnapshotRequestPayload = {
    query: DockerContainerProcessesQueryInput
}

export type DockerContainerProcessesSnapshot = {
    generatedAt: string
    data: DockerContainerProcessEntry[]
}

export type DockerContainerProcessesSnapshotResponsePayload = {
    snapshot: DockerContainerProcessesSnapshot
    responderNodeId: string | null
}

export type DockerContainerProcessLogsSnapshotRequestPayload = {
    query: DockerContainerProcessLogsStreamQueryInput
}

export type DockerContainerProcessLogsSnapshotResponsePayload = {
    snapshot: DockerContainerLogsSnapshot
    responderNodeId: string | null
}

export type DockerContainerFilesSnapshotRequestPayload = {
    query: DockerContainerFilesQueryInput
}

export type DockerContainerFilesSnapshot = {
    containerId: string
    path: string
    generatedAt: string
    entries: DockerFileEntry[]
}

export type DockerContainerFilesSnapshotResponsePayload = {
    snapshot: DockerContainerFilesSnapshot
    responderNodeId: string | null
}

export type DockerContainerReadFileSnapshotRequestPayload = {
    query: DockerContainerReadFileQueryInput
}

export type DockerContainerReadFileSnapshot = {
    containerId: string
    path: string
    generatedAt: string
    encoding: 'utf8'
    content: string
}

export type DockerContainerReadFileSnapshotResponsePayload = {
    snapshot: DockerContainerReadFileSnapshot
    responderNodeId: string | null
}

export type DockerContainerWriteFileRequestPayload = {
    body: DockerContainerWriteFileBodyInput
}

export type DockerContainerMutationAck = {
    ok: true
    timestamp: string
}

export type DockerContainerWriteFileResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerContainerDeletePathRequestPayload = {
    body: DockerContainerDeletePathBodyInput
}

export type DockerContainerDeletePathResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerContainerRenamePathRequestPayload = {
    body: DockerContainerRenamePathBodyInput
}

export type DockerContainerRenamePathResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerContainerCreateDirectoryRequestPayload = {
    body: DockerContainerCreateDirectoryBodyInput
}

export type DockerContainerCreateDirectoryResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerContainerTerminalOpenRequestPayload = {
    body: DockerContainerTerminalOpenBodyInput
}

export type DockerContainerTerminalOpenResult = {
    sessionId: string
    containerId: string
    shell: 'bash' | 'sh' | 'zsh' | 'ash'
    user: string
    workingDir: string
    profiles: DockerTerminalProfile[]
    openedAt: string
}

export type DockerContainerTerminalOpenResponsePayload = {
    session: DockerContainerTerminalOpenResult
    responderNodeId: string | null
}

export type DockerContainerTerminalEventsRequestPayload = {
    query: {
        sessionId: string
        afterSequence?: number
    }
}

export type DockerContainerTerminalStoredEvent = {
    sequence: number
    sessionId: string
    timestamp: string
    type: 'output' | 'status' | 'error'
    data: string
}

export type DockerContainerTerminalEventsSnapshot = {
    sessionId: string
    generatedAt: string
    closed: boolean
    latestSequence: number
    events: DockerContainerTerminalStoredEvent[]
}

export type DockerContainerTerminalEventsResponsePayload = {
    snapshot: DockerContainerTerminalEventsSnapshot
    responderNodeId: string | null
}

export type DockerContainerTerminalInputRequestPayload = {
    body: DockerContainerTerminalInputBodyInput
}

export type DockerContainerTerminalInputResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerContainerTerminalCloseRequestPayload = {
    body: DockerContainerTerminalCloseBodyInput
}

export type DockerContainerTerminalCloseResponsePayload = {
    ack: DockerContainerMutationAck
    responderNodeId: string | null
}

export type DockerImageInspectRequestPayload = {
    query: DockerImageInspectQueryInput
}

export type DockerImageInspectResponsePayload = {
    detail: DockerImageInspectDetail
    responderNodeId: string | null
}
