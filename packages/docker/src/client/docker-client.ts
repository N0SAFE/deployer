import * as fs from 'node:fs'

import Docker from 'dockerode'
import { Context, Effect, Layer } from 'effect'

/** How to reach the Docker engine. */
export type DockerConnectionConfig = {
    /** `DOCKER_HOST`, e.g. `unix:///var/run/docker.sock` or `tcp://host:2375`. */
    readonly host: string | undefined
    /** `DOCKER_PORT` — only meaningful when `host` is a TCP address. */
    readonly port: number | undefined
}

export type ResolvedDockerClient = {
    readonly client: Docker
    /** How the connection was chosen, for the startup log. */
    readonly mode: string
    /** Set when the engine is reached over a unix socket; containers that drive Docker mount it. */
    readonly socketPath: string | null
    /** Things worth a warning that the caller logs. */
    readonly warnings: readonly string[]
}

export const DEFAULT_DOCKER_SOCKET_PATH = '/var/run/docker.sock'

const isLocalhost = (host: string) =>
    host === 'localhost' || host === '127.0.0.1' || host === '::1'

/**
 * Chooses the engine connection from `DOCKER_HOST`/`DOCKER_PORT` and what the filesystem offers.
 * Pure but for the socket check, so the rules are testable with a fake `socketExists`.
 */
export function resolveDockerClient(
    config: DockerConnectionConfig,
    socketExists: (path: string) => boolean = fs.existsSync
): ResolvedDockerClient {
    const hasMountedSocket = socketExists(DEFAULT_DOCKER_SOCKET_PATH)
    const hostRaw = config.host?.trim() ?? ''
    const viaSocket = (
        socketPath: string,
        mode: string,
        warnings: readonly string[] = []
    ): ResolvedDockerClient => ({
        client: new Docker({ socketPath }),
        mode,
        socketPath,
        warnings,
    })

    if (hostRaw.length > 0) {
        if (hostRaw.startsWith('unix://')) {
            const socketPath = hostRaw.slice('unix://'.length)
            return viaSocket(
                socketPath,
                `DOCKER_HOST unix socket (${socketPath})`
            )
        }
        if (hostRaw.startsWith('/'))
            return viaSocket(hostRaw, `DOCKER_HOST socket path (${hostRaw})`)

        if (
            isLocalhost(hostRaw) &&
            config.port === undefined &&
            hasMountedSocket
        ) {
            return viaSocket(
                DEFAULT_DOCKER_SOCKET_PATH,
                'mounted Docker socket fallback',
                [
                    `DOCKER_HOST=${hostRaw} has no DOCKER_PORT. Falling back to mounted Docker socket at ${DEFAULT_DOCKER_SOCKET_PATH}.`,
                ]
            )
        }

        if (
            hostRaw.startsWith('tcp://') ||
            hostRaw.startsWith('http://') ||
            hostRaw.startsWith('https://')
        ) {
            const normalized = hostRaw.startsWith('tcp://')
                ? `http://${hostRaw.slice('tcp://'.length)}`
                : hostRaw
            const url = new URL(normalized)
            const port =
                config.port ??
                (url.port.length > 0 ? Number(url.port) : undefined)
            if (
                isLocalhost(url.hostname) &&
                port === undefined &&
                hasMountedSocket
            ) {
                return viaSocket(
                    DEFAULT_DOCKER_SOCKET_PATH,
                    'mounted Docker socket fallback',
                    [
                        `DOCKER_HOST=${hostRaw} points to localhost without port. Falling back to mounted Docker socket at ${DEFAULT_DOCKER_SOCKET_PATH}.`,
                    ]
                )
            }
            return {
                client: new Docker({
                    host: url.hostname,
                    port,
                    protocol: url.protocol === 'https:' ? 'https' : 'http',
                }),
                mode: `DOCKER_HOST URL (${hostRaw})`,
                socketPath: null,
                warnings: [],
            }
        }

        return {
            client: new Docker({ host: hostRaw, port: config.port }),
            mode: `DOCKER_HOST host (${hostRaw})`,
            socketPath: null,
            warnings: [],
        }
    }

    if (hasMountedSocket)
        return viaSocket(DEFAULT_DOCKER_SOCKET_PATH, 'mounted Docker socket')
    return {
        client: new Docker(),
        mode: 'dockerode default connection',
        socketPath: null,
        warnings: [],
    }
}

/** The dockerode client every engine operation goes through. */
export class DockerClient extends Context.Service<DockerClient, Docker>()(
    'docker/DockerClient'
) {
    /** Connects as `config` says, logging how it chose to. */
    static readonly layer = (
        config: DockerConnectionConfig
    ): Layer.Layer<DockerClient> =>
        Layer.effect(
            DockerClient,
            Effect.gen(function* () {
                const resolved = resolveDockerClient(config)
                for (const warning of resolved.warnings)
                    yield* Effect.logWarning(warning)
                yield* Effect.logInfo(`Docker engine via ${resolved.mode}`)
                return resolved.client
            })
        )
}
