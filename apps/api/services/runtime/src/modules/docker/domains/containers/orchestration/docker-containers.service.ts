import { Context, Effect } from 'effect'

import {
    dockerContainerLinkPathSchema,
    type DockerContainerLinkPath,
    type DockerContainerLinkedList,
} from '@deployer/contracts-entities'
import { DockerEngine } from '@deployer/docker'
import type { Over } from '@deployer/effect-core'
import { AppError } from '@deployer/errors'
import { AppLogger } from '@deployer/logger'
import type {
    DockerContainerCreateDirectoryBodyInput,
    DockerContainerDeletePathBodyInput,
    DockerContainerFilesQueryInput,
    DockerContainerLinkedListQueryInput,
    DockerContainerLogsStreamQueryInput,
    DockerContainerProcessesQueryInput,
    DockerContainerReadFileQueryInput,
    DockerContainerRenamePathBodyInput,
    DockerContainerRuntimeActionAck,
    DockerContainerRuntimeActionBodyInput,
    DockerContainerTerminalCloseBodyInput,
    DockerContainerTerminalInputBodyInput,
    DockerContainerTerminalOpenBodyInput,
    DockerContainerWriteFileBodyInput,
} from '@deployer/runtime-contracts/modules/docker/containers/shared'

import {
    RuntimeDb,
    RuntimeDatabasePort,
} from '../../../../../core/database/runtime-db'
import { DockerContainerLinks } from '../../../repositories/containers/links/docker-container-links'
import { DockerContainerLinksLookup } from '../../../repositories/containers/links/docker-container-links-lookup.repository'
import {
    DockerContainerAccess,
    type DockerContainerAccessShape,
} from '../runtime/docker-container-access'

import {
    DockerContainerResolution,
    type DockerContainerResolutionPorts,
} from './docker-container-resolution'

/** The label the supervisors stamp on the containers they own. */
const PLATFORM_ROLE_LABEL = 'deployer.platform.role'
/** What a caller may not do to a platform container. */
const PROTECTED_ACTIONS: ReadonlySet<string> = new Set([
    'stop',
    'restart',
    'pause',
    'kill',
    'remove',
])

const apiLogger = new AppLogger('api').scope(
    'DockerContainersOrchestratorService'
)
const debugLogger = apiLogger.createContextFilterLogger({
    defaultClassName: 'DockerContainersOrchestratorService',
    filterEnvVar: 'APP_DEBUG_CONTEXT_FILTER',
    channel: 'docker-containers-orchestrator',
})

const debug = (source: string, context?: Record<string, unknown>): void => {
    apiLogger.log.info(
        `[docker-containers-orchestrator] ${source}`,
        context ?? {}
    )
    debugLogger.debug(source, context)
}

const parseIncludePaths = (
    include: string | undefined,
    maxDepth: number
): DockerContainerLinkPath[] => {
    if (!include || include.trim().length === 0) {
        return []
    }

    const normalizedDepth = Math.max(1, Math.min(3, maxDepth))

    const uniquePaths = new Set<DockerContainerLinkPath>()
    const tokens = include
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)

    for (const token of tokens) {
        const parsedPath = dockerContainerLinkPathSchema.safeParse(token)
        if (!parsedPath.success) {
            continue
        }

        if (parsedPath.data.split('.').length <= normalizedDepth) {
            uniquePaths.add(parsedPath.data)
        }
    }

    return [...uniquePaths]
}

/** What the linked list reads: the resolution page, the links behind it, and the database behind those. */
type LinkedListRequirements =
    | DockerContainerResolution
    | DockerContainerResolutionPorts
    | DockerContainerLinks
    | DockerContainerLinksLookup
    | RuntimeDb
    | RuntimeDatabasePort

/**
 * The file/terminal operations, with the access tag they are reached through: a caller provides both the tag and the
 * ports behind it, which is why the channel is derived from the operations instead of written twice.
 */
type AccessOperations = Over<
    Pick<
        DockerContainerAccessShape,
        | 'listLogs'
        | 'listProcesses'
        | 'listFiles'
        | 'readFile'
        | 'writeFile'
        | 'deletePath'
        | 'renamePath'
        | 'createDirectory'
        | 'openTerminal'
        | 'sendTerminalInput'
        | 'closeTerminal'
    >,
    DockerContainerAccess
>

/**
 * The unary container surface a handler may call, as an Effect service.
 *
 * Every operation IS the logic: it yields the collaborator that serves it where it uses it. The file operations reach
 * `DockerContainerAccess`, which owns the engine/mesh fallback; `listLinked` joins the resolved page with its links;
 * `runAction` guards and dispatches the lifecycle call. Streams are not here — they live on
 * `DockerContainersOrchestratorService`, which is the RxJS boundary.
 */
export type DockerContainersShape = {
    readonly listLinked: (
        input: DockerContainerLinkedListQueryInput,
        platformRole: string | null
    ) => Effect.Effect<
        DockerContainerLinkedList,
        unknown,
        LinkedListRequirements
    >
    readonly runAction: (
        input: DockerContainerRuntimeActionBodyInput
    ) => Effect.Effect<DockerContainerRuntimeActionAck, unknown, DockerEngine>
} & AccessOperations

/** Everything a caller must be able to see for these calls to run, read off the operations themselves. */
export type DockerContainersPorts = {
    [K in keyof DockerContainersShape]: DockerContainersShape[K] extends (
        ...args: never[]
    ) => Effect.Effect<unknown, unknown, infer R>
        ? R
        : never
}[keyof DockerContainersShape]

export class DockerContainers extends Context.Service<
    DockerContainers,
    DockerContainersShape
>()('runtime/DockerContainers') {
    static readonly live = class DockerContainersImpl
        implements DockerContainersShape
    {
        listLinked(
            input: DockerContainerLinkedListQueryInput,
            platformRole: string | null
        ): Effect.Effect<
            DockerContainerLinkedList,
            unknown,
            LinkedListRequirements
        > {
            return Effect.gen(function* () {
                debug(
                    'DockerContainersOrchestratorService.listContainersLinked',
                    {
                        limit: input.limit,
                        offset: input.offset,
                        include: input.include,
                        maxDepth: input.maxDepth,
                        platformRole,
                    }
                )

                const resolution = yield* DockerContainerResolution
                const links = yield* DockerContainerLinks

                const { include, maxDepth, ...listInput } = input
                const containerList =
                    yield* resolution.listContainers(listInput)
                const data = yield* links.attach(
                    containerList.data,
                    parseIncludePaths(include, maxDepth),
                    platformRole
                )

                return { data, meta: containerList.meta }
            })
        }

        runAction(
            input: DockerContainerRuntimeActionBodyInput
        ): Effect.Effect<
            DockerContainerRuntimeActionAck,
            unknown,
            DockerEngine
        > {
            return Effect.gen(function* () {
                debug('DockerContainersOrchestratorService.runContainerAction', {
                    containerId: input.containerId,
                    action: input.action,
                })

                const dockerEngine = yield* DockerEngine

                // CLUSTER-004: a platform-managed container is owned by a supervisor. Stopping, killing or removing it from the
                // dashboard takes the ingress, database or agent down without the platform noticing, so those actions are refused.
                // Starting and unpausing stay allowed: they are recovery, not destruction.
                if (PROTECTED_ACTIONS.has(input.action)) {
                    const info = yield* dockerEngine.containers
                        .inspect(input.containerId)
                        .pipe(Effect.catch(() => Effect.succeed(null)))
                    const managedBy = info?.Config.Labels[PLATFORM_ROLE_LABEL]
                    if (managedBy !== undefined && managedBy !== '') {
                        return yield* Effect.fail(
                            new AppError(
                                `Container ${input.containerId} is managed by the platform (${managedBy}): ${input.action} is refused. ` +
                                    "Use the platform's own controls; a copy started by hand is not supervised.",
                                'FORBIDDEN'
                            )
                        )
                    }
                }

                switch (input.action) {
                    case 'start': {
                        yield* dockerEngine.containers.start(input.containerId)
                        break
                    }
                    case 'stop': {
                        yield* dockerEngine.containers.stop(input.containerId)
                        break
                    }
                    case 'restart': {
                        yield* dockerEngine.containers.restart(
                            input.containerId
                        )
                        break
                    }
                    case 'pause': {
                        yield* dockerEngine.containers.pause(input.containerId)
                        break
                    }
                    case 'unpause': {
                        yield* dockerEngine.containers.unpause(
                            input.containerId
                        )
                        break
                    }
                    case 'kill': {
                        yield* dockerEngine.containers.kill(input.containerId)
                        break
                    }
                    case 'remove': {
                        yield* dockerEngine.containers.remove(input.containerId)
                        break
                    }
                    default: {
                        const exhaustiveCheck: never = input.action
                        return yield* Effect.die(
                            new AppError(
                                `Unsupported container action: ${String(exhaustiveCheck)}`,
                                'INTERNAL_ERROR'
                            )
                        )
                    }
                }

                return {
                    ok: true as const,
                    containerId: input.containerId,
                    action: input.action,
                    timestamp: new Date(),
                }
            })
        }

        listLogs(
            input: DockerContainerLogsStreamQueryInput
        ): ReturnType<DockerContainersShape['listLogs']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.listLogs(input)
            )
        }

        listProcesses(
            input: DockerContainerProcessesQueryInput
        ): ReturnType<DockerContainersShape['listProcesses']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.listProcesses(input)
            )
        }

        listFiles(
            input: DockerContainerFilesQueryInput
        ): ReturnType<DockerContainersShape['listFiles']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.listFiles(input)
            )
        }

        readFile(
            input: DockerContainerReadFileQueryInput
        ): ReturnType<DockerContainersShape['readFile']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.readFile(input)
            )
        }

        writeFile(
            input: DockerContainerWriteFileBodyInput
        ): ReturnType<DockerContainersShape['writeFile']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.writeFile(input)
            )
        }

        deletePath(
            input: DockerContainerDeletePathBodyInput
        ): ReturnType<DockerContainersShape['deletePath']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.deletePath(input)
            )
        }

        renamePath(
            input: DockerContainerRenamePathBodyInput
        ): ReturnType<DockerContainersShape['renamePath']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.renamePath(input)
            )
        }

        createDirectory(
            input: DockerContainerCreateDirectoryBodyInput
        ): ReturnType<DockerContainersShape['createDirectory']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.createDirectory(input)
            )
        }

        openTerminal(
            input: DockerContainerTerminalOpenBodyInput
        ): ReturnType<DockerContainersShape['openTerminal']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.openTerminal(input)
            )
        }

        sendTerminalInput(
            input: DockerContainerTerminalInputBodyInput
        ): ReturnType<DockerContainersShape['sendTerminalInput']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.sendTerminalInput(input)
            )
        }

        closeTerminal(
            input: DockerContainerTerminalCloseBodyInput
        ): ReturnType<DockerContainersShape['closeTerminal']> {
            return Effect.flatMap(DockerContainerAccess, (access) =>
                access.closeTerminal(input)
            )
        }
    }
}
