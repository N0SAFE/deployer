import { Context, Effect } from 'effect'
import { Observable, catchError, map, throwError } from 'rxjs'

import type {
    DockerContainerLogEntry,
    DockerContainerProcessEntry,
} from '@deployer/contracts-entities'
import { DockerEngine } from '@deployer/docker'
import type {
    DockerContainerCreateDirectoryBodyInput,
    DockerContainerDeletePathBodyInput,
    DockerContainerFilesQueryInput,
    DockerContainerLogsStreamQueryInput,
    DockerContainerProcessLogsStreamQueryInput,
    DockerContainerProcessesQueryInput,
    DockerContainerProcessesStreamQueryInput,
    DockerContainerReadFileQueryInput,
    DockerContainerRenamePathBodyInput,
    DockerContainerTerminalCloseBodyInput,
    DockerContainerTerminalInputBodyInput,
    DockerContainerTerminalOpenBodyInput,
    DockerContainerTerminalStreamQueryInput,
    DockerContainerWriteFileBodyInput,
} from '@deployer/runtime-contracts/modules/docker/containers/shared'

import {
    pollSnapshot,
    streamLogs,
    streamProcessLogs,
} from './container-streams'
import {
    DockerContainerOps,
    type DockerContainerOpsShape,
} from './docker-container-ops'
import {
    DockerTerminalSessions,
    type DockerTerminalSessionsShape,
} from './docker-terminal-sessions'
import {
    MESH_FIRST_RESPONSE,
    firstResponse,
    isContainerNotFoundLikeError,
    isTerminalSessionNotFoundError,
    streamMeshLogs,
    streamMeshSnapshots,
    streamMeshTerminalEvents,
    withMeshFallback,
} from './mesh-fallback'

import type { FileMutationAck } from './container-file-ops'
import type { DockerNodeMesh } from '../mesh/docker-node-mesh'
import type { DockerContainerTerminalOpenResult } from '../mesh/node-mesh-types'

/** The mesh calls that reach the node owning a container; a Promise-based Nest provider until the mesh moves. */
export class ContainerAccessMeshPort extends Context.Service<
    ContainerAccessMeshPort,
    Pick<
        DockerNodeMesh,
        | 'listContainerLogsSnapshotAcrossInstances'
        | 'listContainerProcessesSnapshotAcrossInstances'
        | 'listContainerProcessLogsSnapshotAcrossInstances'
        | 'listContainerFilesSnapshotAcrossInstances'
        | 'readContainerFileSnapshotAcrossInstances'
        | 'writeContainerFileAcrossInstances'
        | 'deleteContainerPathAcrossInstances'
        | 'renameContainerPathAcrossInstances'
        | 'createContainerDirectoryAcrossInstances'
        | 'openContainerTerminalSessionAcrossInstances'
        | 'listContainerTerminalSessionEventsAcrossInstances'
        | 'sendContainerTerminalInputAcrossInstances'
        | 'closeContainerTerminalSessionAcrossInstances'
    >
>()('runtime/ContainerAccessMeshPort') {}

/** What every access operation reads from the Effect context while it runs. */
export type ContainerAccessServices =
    | DockerEngine
    | DockerContainerOps
    | DockerTerminalSessions
    | ContainerAccessMeshPort

export type TerminalStreamEvent = {
    sessionId: string
    timestamp: Date
    type: 'output' | 'status' | 'error'
    data: string
}

type E<A> = Effect.Effect<A, unknown, ContainerAccessServices>
type Success<F extends (...args: never[]) => unknown> = Effect.Success<
    ReturnType<F>
>
type Ops = DockerContainerOpsShape
type Sessions = DockerTerminalSessionsShape
type Snapshot = { generatedAt: string; data: DockerContainerProcessEntry[] }

export type DockerContainerAccessShape = {
    readonly streamLogs: (
        input: DockerContainerLogsStreamQueryInput
    ) => E<Observable<DockerContainerLogEntry>>
    readonly listLogs: (
        input: DockerContainerLogsStreamQueryInput
    ) => E<Success<Ops['logsSnapshot']>>
    readonly listProcesses: (
        input: DockerContainerProcessesQueryInput
    ) => E<Snapshot>
    readonly streamProcesses: (
        input: DockerContainerProcessesStreamQueryInput
    ) => E<Observable<Snapshot>>
    readonly streamProcessLogs: (
        input: DockerContainerProcessLogsStreamQueryInput
    ) => E<Observable<DockerContainerLogEntry>>
    readonly listFiles: (
        input: DockerContainerFilesQueryInput
    ) => E<Success<Ops['listFiles']>>
    readonly readFile: (
        input: DockerContainerReadFileQueryInput
    ) => E<Success<Ops['readFile']>>
    readonly writeFile: (
        input: DockerContainerWriteFileBodyInput
    ) => E<FileMutationAck>
    readonly deletePath: (
        input: DockerContainerDeletePathBodyInput
    ) => E<FileMutationAck>
    readonly renamePath: (
        input: DockerContainerRenamePathBodyInput
    ) => E<FileMutationAck>
    readonly createDirectory: (
        input: DockerContainerCreateDirectoryBodyInput
    ) => E<FileMutationAck>
    readonly openTerminal: (
        input: DockerContainerTerminalOpenBodyInput
    ) => E<DockerContainerTerminalOpenResult>
    readonly streamTerminal: (
        input: DockerContainerTerminalStreamQueryInput
    ) => E<Observable<TerminalStreamEvent>>
    readonly sendTerminalInput: (
        input: DockerContainerTerminalInputBodyInput
    ) => E<Success<Sessions['sendInput']>>
    readonly closeTerminal: (
        input: DockerContainerTerminalCloseBodyInput
    ) => E<Success<Sessions['close']>>
}

const toDate = (value: string | Date): Date =>
    value instanceof Date ? value : new Date(value)

/** Run the local operation; if this node does not know the container, ask the mesh and use the first answer. */
const containerFallback = <A>(
    local: E<A>,
    mesh: (ports: ContainerAccessMeshPort['Service']) => Promise<A | null>
): E<A> =>
    Effect.flatMap(ContainerAccessMeshPort, (ports) =>
        withMeshFallback(local, () => mesh(ports), isContainerNotFoundLikeError)
    )

const terminalFallback = <A>(
    local: E<A>,
    mesh: (ports: ContainerAccessMeshPort['Service']) => Promise<A | null>,
    onNobody?: () => A
): E<A> =>
    Effect.flatMap(ContainerAccessMeshPort, (ports) => {
        const attempt = withMeshFallback(
            local,
            () => mesh(ports),
            isTerminalSessionNotFoundError
        )
        return onNobody === undefined
            ? attempt
            : Effect.catch(attempt, () => Effect.sync(onNobody))
    })

/**
 * Container operations that follow the container: local when this node has it, across the mesh when another node does.
 * A constant that reads the engine, the local operations, the terminal sessions and the mesh port from the Effect
 * context when an operation runs. Streams are RxJS built from those, with the same mesh fallback.
 */
export class DockerContainerAccess extends Context.Service<
    DockerContainerAccess,
    DockerContainerAccessShape
>()('runtime/DockerContainerAccess') {
    static readonly live = class DockerContainerAccessImpl implements DockerContainerAccessShape {
        streamLogs = (input: DockerContainerLogsStreamQueryInput) =>
            Effect.gen(function* () {
                const ops = yield* DockerContainerOps
                const mesh = yield* ContainerAccessMeshPort
                const collect = yield* ops.logsCollector(input.containerId)
                return streamLogs(collect, input).pipe(
                    catchError((error: unknown) =>
                        isContainerNotFoundLikeError(error)
                            ? streamMeshLogs(
                                  async () =>
                                      (
                                          await firstResponse(
                                              mesh.listContainerLogsSnapshotAcrossInstances(
                                                  { query: input },
                                                  MESH_FIRST_RESPONSE
                                              )
                                          )
                                      )?.snapshot.entries ?? [],
                                  input.refreshIntervalMs
                              )
                            : throwError(() => error)
                    )
                )
            })

        listLogs = (input: DockerContainerLogsStreamQueryInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.logsSnapshot(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.listContainerLogsSnapshotAcrossInstances(
                                    { query: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.snapshot ?? null
                )
            )

        listProcesses = (input: DockerContainerProcessesQueryInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.processes(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.listContainerProcessesSnapshotAcrossInstances(
                                    { query: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.snapshot ?? null
                )
            )

        streamProcesses = (input: DockerContainerProcessesStreamQueryInput) =>
            Effect.gen(function* () {
                const ops = yield* DockerContainerOps
                const mesh = yield* ContainerAccessMeshPort
                const context = yield* Effect.context<
                    DockerEngine | DockerContainerOps
                >()
                const local = () =>
                    Effect.runPromise(
                        ops
                            .processes({ containerId: input.containerId })
                            .pipe(Effect.provideContext(context))
                    )
                return pollSnapshot(local, input.refreshIntervalMs).pipe(
                    catchError((error: unknown) =>
                        isContainerNotFoundLikeError(error)
                            ? streamMeshSnapshots<Snapshot>(async () => {
                                  const snapshot = (
                                      await firstResponse(
                                          mesh.listContainerProcessesSnapshotAcrossInstances(
                                              {
                                                  query: {
                                                      containerId:
                                                          input.containerId,
                                                  },
                                              },
                                              MESH_FIRST_RESPONSE
                                          )
                                      )
                                  )?.snapshot
                                  return snapshot
                                      ? {
                                            generatedAt: snapshot.generatedAt,
                                            data: snapshot.data,
                                        }
                                      : null
                              }, input.refreshIntervalMs)
                            : throwError(() => error)
                    )
                )
            })

        streamProcessLogs = (
            input: DockerContainerProcessLogsStreamQueryInput
        ) =>
            Effect.gen(function* () {
                const ops = yield* DockerContainerOps
                const mesh = yield* ContainerAccessMeshPort
                const collect = yield* ops.logsCollector(input.containerId)
                return streamProcessLogs(collect, input).pipe(
                    catchError((error: unknown) =>
                        isContainerNotFoundLikeError(error)
                            ? streamMeshLogs(
                                  async () =>
                                      (
                                          await firstResponse(
                                              mesh.listContainerProcessLogsSnapshotAcrossInstances(
                                                  { query: input },
                                                  MESH_FIRST_RESPONSE
                                              )
                                          )
                                      )?.snapshot.entries ?? [],
                                  input.refreshIntervalMs
                              )
                            : throwError(() => error)
                    )
                )
            })

        listFiles = (input: DockerContainerFilesQueryInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.listFiles(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.listContainerFilesSnapshotAcrossInstances(
                                    { query: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.snapshot ?? null
                )
            )

        readFile = (input: DockerContainerReadFileQueryInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.readFile(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.readContainerFileSnapshotAcrossInstances(
                                    { query: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.snapshot ?? null
                )
            )

        writeFile = (input: DockerContainerWriteFileBodyInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.writeFile(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.writeContainerFileAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null
                )
            )

        deletePath = (input: DockerContainerDeletePathBodyInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.deletePath(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.deleteContainerPathAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null
                )
            )

        renamePath = (input: DockerContainerRenamePathBodyInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.renamePath(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.renameContainerPathAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null
                )
            )

        createDirectory = (input: DockerContainerCreateDirectoryBodyInput) =>
            Effect.flatMap(DockerContainerOps, (ops) =>
                containerFallback(
                    ops.createDirectory(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.createContainerDirectoryAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null
                )
            )

        openTerminal = (input: DockerContainerTerminalOpenBodyInput) =>
            Effect.flatMap(DockerTerminalSessions, (sessions) =>
                Effect.flatMap(ContainerAccessMeshPort, (ports) =>
                    withMeshFallback(
                        sessions.open(input),
                        async () =>
                            (
                                await firstResponse(
                                    ports.openContainerTerminalSessionAcrossInstances(
                                        { body: input },
                                        MESH_FIRST_RESPONSE
                                    )
                                )
                            )?.session ?? null,
                        isContainerNotFoundLikeError
                    )
                )
            )

        streamTerminal = (input: DockerContainerTerminalStreamQueryInput) =>
            Effect.gen(function* () {
                const sessions = yield* DockerTerminalSessions
                const mesh = yield* ContainerAccessMeshPort
                const local = yield* sessions.stream(input)
                return local.pipe(
                    map((event): TerminalStreamEvent => ({
                        sessionId: event.sessionId,
                        timestamp: toDate(event.timestamp),
                        type: event.type,
                        data: event.data,
                    })),
                    catchError((error: unknown) =>
                        isTerminalSessionNotFoundError(error)
                            ? streamMeshTerminalEvents(
                                  async (afterSequence) =>
                                      (
                                          await firstResponse(
                                              mesh.listContainerTerminalSessionEventsAcrossInstances(
                                                  {
                                                      query: {
                                                          sessionId:
                                                              input.sessionId,
                                                          afterSequence,
                                                      },
                                                  },
                                                  MESH_FIRST_RESPONSE
                                              )
                                          )
                                      )?.snapshot ?? null,
                                  (event): TerminalStreamEvent => ({
                                      sessionId: event.sessionId,
                                      timestamp: new Date(event.timestamp),
                                      type: event.type,
                                      data: event.data,
                                  })
                              )
                            : throwError(() => error)
                    )
                )
            })

        sendTerminalInput = (input: DockerContainerTerminalInputBodyInput) =>
            Effect.flatMap(DockerTerminalSessions, (sessions) =>
                terminalFallback(
                    sessions.sendInput(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.sendContainerTerminalInputAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null
                )
            )

        closeTerminal = (input: DockerContainerTerminalCloseBodyInput) =>
            Effect.flatMap(DockerTerminalSessions, (sessions) =>
                terminalFallback(
                    sessions.close(input),
                    async (mesh) =>
                        (
                            await firstResponse(
                                mesh.closeContainerTerminalSessionAcrossInstances(
                                    { body: input },
                                    MESH_FIRST_RESPONSE
                                )
                            )
                        )?.ack ?? null,
                    // Nobody has the session either: closing something that is gone is a success.
                    () =>
                        ({ ok: true as const, timestamp: new Date() }) as never
                )
            )
    }
}
