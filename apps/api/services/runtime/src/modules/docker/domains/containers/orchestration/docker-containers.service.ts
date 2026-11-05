import { Context } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'
import type {
    DockerContainerCreateDirectoryBodyInput,
    DockerContainerDeletePathBodyInput,
    DockerContainerFilesQueryInput,
    DockerContainerLinkedListQueryInput,
    DockerContainerLogsStreamQueryInput,
    DockerContainerProcessesQueryInput,
    DockerContainerReadFileQueryInput,
    DockerContainerRenamePathBodyInput,
    DockerContainerRuntimeActionBodyInput,
    DockerContainerTerminalCloseBodyInput,
    DockerContainerTerminalInputBodyInput,
    DockerContainerTerminalOpenBodyInput,
    DockerContainerWriteFileBodyInput,
} from '@deployer/runtime-contracts/modules/docker/containers/shared'

import {
    DockerContainersOrchestratorService,
    type DockerContainersOrchestratorPorts,
} from './docker-containers-orchestrator.service'

/**
 * The unary container surface a handler may call, as an Effect service.
 *
 * It delegates to `DockerContainersOrchestratorService`, whose constant methods yield their collaborators when they
 * run; this shape is what the handlers name, so the requirement gate audits the dependency. Streams stay on the
 * orchestrator, which is the RxJS boundary.
 */
export type DockerContainersShape = {
    readonly listLinked: (
        input: DockerContainerLinkedListQueryInput,
        platformRole: string | null
    ) => ReturnType<DockerContainersOrchestratorService['listContainersLinked']>
    readonly runAction: (
        input: DockerContainerRuntimeActionBodyInput
    ) => ReturnType<DockerContainersOrchestratorService['runContainerAction']>
    readonly listLogs: (
        input: DockerContainerLogsStreamQueryInput
    ) => ReturnType<DockerContainersOrchestratorService['listContainerLogs']>
    readonly listProcesses: (
        input: DockerContainerProcessesQueryInput
    ) => ReturnType<
        DockerContainersOrchestratorService['listContainerProcesses']
    >
    readonly listFiles: (
        input: DockerContainerFilesQueryInput
    ) => ReturnType<DockerContainersOrchestratorService['listContainerFiles']>
    readonly readFile: (
        input: DockerContainerReadFileQueryInput
    ) => ReturnType<DockerContainersOrchestratorService['readContainerFile']>
    readonly writeFile: (
        input: DockerContainerWriteFileBodyInput
    ) => ReturnType<DockerContainersOrchestratorService['writeContainerFile']>
    readonly deletePath: (
        input: DockerContainerDeletePathBodyInput
    ) => ReturnType<DockerContainersOrchestratorService['deleteContainerPath']>
    readonly renamePath: (
        input: DockerContainerRenamePathBodyInput
    ) => ReturnType<DockerContainersOrchestratorService['renameContainerPath']>
    readonly createDirectory: (
        input: DockerContainerCreateDirectoryBodyInput
    ) => ReturnType<
        DockerContainersOrchestratorService['createContainerDirectory']
    >
    readonly openTerminal: (
        input: DockerContainerTerminalOpenBodyInput
    ) => ReturnType<
        DockerContainersOrchestratorService['openContainerTerminalSession']
    >
    readonly sendTerminalInput: (
        input: DockerContainerTerminalInputBodyInput
    ) => ReturnType<
        DockerContainersOrchestratorService['sendContainerTerminalInput']
    >
    readonly closeTerminal: (
        input: DockerContainerTerminalCloseBodyInput
    ) => ReturnType<
        DockerContainersOrchestratorService['closeContainerTerminalSession']
    >
}

/** Everything a caller must be able to see for these calls to run. */
export type DockerContainersPorts =
    DockerContainersOrchestratorService | DockerContainersOrchestratorPorts

export class DockerContainers extends Context.Service<
    DockerContainers,
    Over<DockerContainersShape, DockerContainersPorts>
>()('runtime/DockerContainers') {
    /** Stateless: the orchestrator is resolved on every call. */
    static readonly live: Over<DockerContainersShape, DockerContainersPorts> =
        serviceOver(
            DockerContainersOrchestratorService,
            (containers): DockerContainersShape => ({
                listLinked: (input, platformRole) =>
                    containers.listContainersLinked(input, platformRole),
                runAction: (input) => containers.runContainerAction(input),
                listLogs: (input) => containers.listContainerLogs(input),
                listProcesses: (input) =>
                    containers.listContainerProcesses(input),
                listFiles: (input) => containers.listContainerFiles(input),
                readFile: (input) => containers.readContainerFile(input),
                writeFile: (input) => containers.writeContainerFile(input),
                deletePath: (input) => containers.deleteContainerPath(input),
                renamePath: (input) => containers.renameContainerPath(input),
                createDirectory: (input) =>
                    containers.createContainerDirectory(input),
                openTerminal: (input) =>
                    containers.openContainerTerminalSession(input),
                sendTerminalInput: (input) =>
                    containers.sendContainerTerminalInput(input),
                closeTerminal: (input) =>
                    containers.closeContainerTerminalSession(input),
            })
        )
}
