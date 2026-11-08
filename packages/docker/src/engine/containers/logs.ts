import { Context, Effect, Stream } from 'effect'

import { DockerUnavailable, type DockerError } from '../../errors/errors'
import { engineCall } from '../call'

import {
    decodeLogsPayload,
    isReadableStream,
    logLines,
    readAll,
} from './streams'

import type Docker from 'dockerode'

export type LogsShape = {
    /** The container's logs as text, multiplexing removed. */
    readonly read: (
        idOrName: string,
        options?: Docker.ContainerLogsOptions
    ) => Effect.Effect<string, DockerError>
    /**
     * The container's logs as they arrive, one line per element; stderr lines start with
     * `stderrPrefix` (default `[stderr] `). Ends when the container's stream does. Stopping early
     * releases the connection.
     */
    readonly stream: (
        idOrName: string,
        options?: Docker.ContainerLogsOptions & { stderrPrefix?: string }
    ) => Stream.Stream<string, DockerError>
}

/**
 * The one implementation of `LogsShape`.
 *
 * Declared at module scope rather than as a class expression on the service: declaration emit
 * cannot describe the private members of an anonymous exported class (TS4094).
 */
class LogsImpl implements LogsShape {
    constructor(private readonly client: Docker) {}

    read(
        idOrName: string,
        options: Docker.ContainerLogsOptions = {
            stdout: true,
            stderr: true,
            tail: 200,
        }
    ): Effect.Effect<string, DockerError> {
        const client = this.client
        return Effect.fn('DockerLogs.read')(function* (this: void) {
            return yield* engineCall(
            `fetch logs for container ${idOrName}`,
            async (signal) => {
                const raw: unknown = await (
                    client.getContainer(idOrName).logs as (
                        opts: Record<string, unknown>
                    ) => Promise<unknown>
                )({
                    stdout: options.stdout !== false,
                    stderr: options.stderr !== false,
                    tail: options.tail ?? 'all',
                    since: options.since,
                    until: options.until,
                    timestamps: options.timestamps,
                    follow: options.follow === true,
                    abortSignal: signal,
                })
                if (typeof raw === 'string') return raw
                if (Buffer.isBuffer(raw) || raw instanceof Uint8Array)
                    return decodeLogsPayload(Buffer.from(raw))
                if (!isReadableStream(raw))
                    throw new Error(
                        'container.logs() returned an unexpected non-stream value'
                    )
                return decodeLogsPayload(await readAll(raw))
            },
            `container '${idOrName}'`
        )
        })()
    }

    stream(
        idOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {}
    ): Stream.Stream<string, DockerError> {
        const client = this.client
        return Stream.unwrap(
            engineCall(
                `follow logs of container ${idOrName}`,
                async () =>
                    await (
                        client.getContainer(idOrName).logs as (
                            opts: Record<string, unknown>
                        ) => Promise<unknown>
                    )({
                        stdout: options.stdout !== false,
                        stderr: options.stderr !== false,
                        follow: true,
                        // 0 = only lines that arrive from now on
                        tail: options.tail ?? 0,
                        timestamps: false,
                    }),
                `container '${idOrName}'`
            ).pipe(
                Effect.map((raw) => {
                    const stderrPrefix = options.stderrPrefix ?? '[stderr] '
                    if (
                        typeof raw === 'string' ||
                        Buffer.isBuffer(raw) ||
                        raw instanceof Uint8Array
                    ) {
                        const text =
                            typeof raw === 'string'
                                ? raw
                                : decodeLogsPayload(Buffer.from(raw))
                        return Stream.fromIterable(
                            text.split('\n').filter((line) => line.length > 0)
                        )
                    }
                    if (!isReadableStream(raw)) {
                        return Stream.fail<DockerError>(
                            new DockerUnavailable({
                                reason: 'container.logs(follow:true) returned an unexpected non-stream value',
                            })
                        )
                    }
                    return Stream.fromAsyncIterable(
                        logLines(
                            raw as unknown as AsyncIterable<unknown>,
                            stderrPrefix
                        ),
                        (cause): DockerError =>
                            new DockerUnavailable({
                                reason: `Log stream of container ${idOrName} failed: ${String(cause)}`,
                                cause,
                            })
                    )
                })
            )
        )
    }
}

/** Container logs as text or as a live line stream, as an Effect service. */
export class Logs extends Context.Service<Logs, LogsShape>()('docker/Logs') {
    /** The implementation: it owns every member body and takes the engine client. */
    static readonly live = LogsImpl
}
