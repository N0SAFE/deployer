import { Context } from 'effect'

import type { DockerContainerStreamsShape } from '../runtime/docker-container-streams'

/** The streams an HTTP handler subscribes to: the RxJS half of the container surface. */
export type DockerContainersOrchestratorShape = DockerContainerStreamsShape

/**
 * The container streams, as an Effect-side token.
 *
 * Streams are RxJS (`containerStreamsOver`), which owns the `EffectHost` runtime touchpoint, so this service is exactly
 * that adapter: there is nothing to forward and no unary surface here — the unary calls live on `DockerContainers`.
 *
 * The `declare` members exist only in type space: the class is the Nest token, and the controller that injects it reads
 * the four streams off the instance.
 */
export class DockerContainersOrchestratorService extends Context.Service<
    DockerContainersOrchestratorService,
    DockerContainersOrchestratorShape
>()('runtime/DockerContainersOrchestratorService') {
    static readonly live = class DockerContainersStreamsImpl
        implements DockerContainersOrchestratorShape
    {
        readonly streamContainerLogs: DockerContainerStreamsShape['streamContainerLogs']
        readonly streamContainerProcesses: DockerContainerStreamsShape['streamContainerProcesses']
        readonly streamContainerProcessLogs: DockerContainerStreamsShape['streamContainerProcessLogs']
        readonly streamContainerTerminalSession: DockerContainerStreamsShape['streamContainerTerminalSession']

        constructor(streams: DockerContainerStreamsShape) {
            this.streamContainerLogs = streams.streamContainerLogs
            this.streamContainerProcesses = streams.streamContainerProcesses
            this.streamContainerProcessLogs = streams.streamContainerProcessLogs
            this.streamContainerTerminalSession =
                streams.streamContainerTerminalSession
        }
    }

    declare readonly streamContainerLogs: DockerContainerStreamsShape['streamContainerLogs']
    declare readonly streamContainerProcesses: DockerContainerStreamsShape['streamContainerProcesses']
    declare readonly streamContainerProcessLogs: DockerContainerStreamsShape['streamContainerProcessLogs']
    declare readonly streamContainerTerminalSession: DockerContainerStreamsShape['streamContainerTerminalSession']
}
