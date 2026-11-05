import { Effect } from 'effect'

import type {
    DockerContainerInspectDetail,
    DockerImageInspectDetail,
} from '@deployer/contracts-entities'
import { DockerEngine } from '@deployer/docker'

import { DockerContainerOps } from '../runtime/docker-container-ops'
import { DockerTerminalSessions } from '../runtime/docker-terminal-sessions'

import type {
    DockerContainerListRequestPayload,
    DockerContainerListResponsePayload,
    DockerContainerInspectResponsePayload,
    DockerRuntimeCatalogResponsePayload,
} from './node-mesh-types'
import type {
    DockerContainerCreateDirectoryRequestPayload,
    DockerContainerDeletePathRequestPayload,
    DockerContainerFilesSnapshot,
    DockerContainerFilesSnapshotRequestPayload,
    DockerContainerLogsSnapshot,
    DockerContainerLogsSnapshotRequestPayload,
    DockerContainerMutationAck,
    DockerContainerProcessLogsSnapshotRequestPayload,
    DockerContainerProcessesSnapshot,
    DockerContainerProcessesSnapshotRequestPayload,
    DockerContainerReadFileSnapshot,
    DockerContainerReadFileSnapshotRequestPayload,
    DockerContainerRenamePathRequestPayload,
    DockerContainerTerminalCloseRequestPayload,
    DockerContainerTerminalEventsRequestPayload,
    DockerContainerTerminalEventsSnapshot,
    DockerContainerTerminalInputRequestPayload,
    DockerContainerTerminalOpenRequestPayload,
    DockerContainerTerminalOpenResult,
    DockerContainerWriteFileRequestPayload,
    DockerImageInspectRequestPayload,
} from './node-mesh-types'
import type { DockerRepository } from '../../../repositories/facade/docker.repository'

type Ack = DockerContainerMutationAck
/** The local operations the mesh asks of this node (each already running on the app's Effect runtime). */
export type LocalNodeOperations = {
    readonly listContainers: (
        query: DockerContainerListRequestPayload['query']
    ) => Promise<Pick<DockerContainerListResponsePayload, 'data' | 'meta'>>
    readonly getLocalDockerDaemonId: () => Promise<string | null>
    readonly inspectContainer: (
        containerId: string
    ) => Promise<DockerContainerInspectDetail>
    readonly getRuntimeCatalogSnapshot: () => Promise<
        DockerRuntimeCatalogResponsePayload['catalog']
    >
    readonly inspectImage: (
        imageId: string
    ) => Promise<DockerImageInspectDetail>
    readonly logsSnapshot: (
        query: DockerContainerLogsSnapshotRequestPayload['query']
    ) => Promise<DockerContainerLogsSnapshot>
    readonly processes: (
        query: DockerContainerProcessesSnapshotRequestPayload['query']
    ) => Promise<DockerContainerProcessesSnapshot>
    readonly processLogsSnapshot: (
        query: DockerContainerProcessLogsSnapshotRequestPayload['query']
    ) => Promise<DockerContainerLogsSnapshot>
    readonly listFiles: (
        query: DockerContainerFilesSnapshotRequestPayload['query']
    ) => Promise<DockerContainerFilesSnapshot>
    readonly readFile: (
        query: DockerContainerReadFileSnapshotRequestPayload['query']
    ) => Promise<DockerContainerReadFileSnapshot>
    readonly writeFile: (
        body: DockerContainerWriteFileRequestPayload['body']
    ) => Promise<Ack>
    readonly deletePath: (
        body: DockerContainerDeletePathRequestPayload['body']
    ) => Promise<Ack>
    readonly renamePath: (
        body: DockerContainerRenamePathRequestPayload['body']
    ) => Promise<Ack>
    readonly createDirectory: (
        body: DockerContainerCreateDirectoryRequestPayload['body']
    ) => Promise<Ack>
    readonly openTerminal: (
        body: DockerContainerTerminalOpenRequestPayload['body']
    ) => Promise<DockerContainerTerminalOpenResult>
    readonly terminalEvents: (
        query: DockerContainerTerminalEventsRequestPayload['query']
    ) => Promise<DockerContainerTerminalEventsSnapshot>
    readonly sendTerminalInput: (
        body: DockerContainerTerminalInputRequestPayload['body']
    ) => Promise<Ack>
    readonly closeTerminal: (
        body: DockerContainerTerminalCloseRequestPayload['body']
    ) => Promise<Ack>
}

/** DI token for this node's local operations: the answers the node router serves. */
export const LOCAL_NODE_OPERATIONS = Symbol('runtime:local-node-operations')

/** Anything that runs an Effect for a Promise caller and rejects with the original failure (the app's `EffectHost`). */
export type EffectPromiseRunner = {
    runUnwrapped: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
}

/**
 * This node's own operations, as the mesh asks for them: the container operations and terminal sessions run as
 * Effects on the app's runtime, and the engine reads go through the repository.
 */
export function makeLocalNodeOperations(
    runtime: EffectPromiseRunner,
    repository: Pick<
        DockerRepository,
        | 'listContainers'
        | 'getLocalDockerDaemonId'
        | 'inspectContainer'
        | 'getRuntimeCatalogSnapshot'
        | 'inspectImage'
    >
): LocalNodeOperations {
    const ops = <A>(
        use: (
            ops: DockerContainerOps['Service']
        ) => Effect.Effect<A, unknown, DockerEngine>
    ) => runtime.runUnwrapped(Effect.flatMap(DockerContainerOps, use))
    const sessions = <A>(
        use: (
            sessions: DockerTerminalSessions['Service']
        ) => Effect.Effect<A, unknown, DockerEngine>
    ) => runtime.runUnwrapped(Effect.flatMap(DockerTerminalSessions, use))

    return {
        listContainers: (query) => repository.listContainers(query),
        getLocalDockerDaemonId: () => repository.getLocalDockerDaemonId(),
        inspectContainer: (containerId) =>
            repository.inspectContainer(containerId),
        getRuntimeCatalogSnapshot: () => repository.getRuntimeCatalogSnapshot(),
        inspectImage: (imageId) => repository.inspectImage(imageId),
        logsSnapshot: (query) => ops((o) => o.logsSnapshot(query)),
        processes: (query) => ops((o) => o.processes(query)),
        processLogsSnapshot: (query) =>
            ops((o) => o.processLogsSnapshot(query)),
        listFiles: (query) => ops((o) => o.listFiles(query)),
        readFile: (query) => ops((o) => o.readFile(query)),
        writeFile: (body) => ops((o) => o.writeFile(body)),
        deletePath: (body) => ops((o) => o.deletePath(body)),
        renamePath: (body) => ops((o) => o.renamePath(body)),
        createDirectory: (body) => ops((o) => o.createDirectory(body)),
        openTerminal: (body) => sessions((s) => s.open(body)),
        terminalEvents: (query) =>
            runtime.runUnwrapped(
                Effect.flatMap(DockerTerminalSessions, (s) => s.events(query))
            ),
        sendTerminalInput: (body) =>
            runtime.runUnwrapped(
                Effect.flatMap(DockerTerminalSessions, (s) => s.sendInput(body))
            ),
        closeTerminal: (body) =>
            runtime.runUnwrapped(
                Effect.flatMap(DockerTerminalSessions, (s) => s.close(body))
            ),
    }
}
