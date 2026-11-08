import { PassThrough } from 'node:stream'

import { Context, Effect } from 'effect'

import { engineMessage } from '../../errors/classify'
import { DockerUnavailable, type DockerError } from '../../errors/errors'
import { engineCall } from '../call'

import {
    extractInlineOutput,
    isReadableStream,
    isWritableStream,
} from './streams'

import type Docker from 'dockerode'

export type ExecResult = { readonly exitCode: number; readonly output: string }

export type InteractiveExecOptions = {
    readonly cmd: string[]
    readonly user?: string
    readonly workingDir?: string
    readonly env?: string[]
    /** `true` upgrades the connection (raw TTY); `false` uses the plain-HTTP transport some proxies need. */
    readonly hijack: boolean
    /** Give up on the attach after this long. */
    readonly timeoutMs: number
}

export type ExecShape = {
    /**
     * Starts an interactive TTY command and hands back its duplex stream; the caller owns the stream
     * (reads, writes, and destroys it). If the upgraded start fails the callback form is tried once,
     * which some daemons need. A start that outlasts `timeoutMs` is a `DockerUnavailable` saying so.
     */
    readonly interactive: (
        idOrName: string,
        options: InteractiveExecOptions
    ) => Effect.Effect<NodeJS.ReadWriteStream, DockerError>
    /**
     * Runs `cmd` in a running container and returns its combined stdout and stderr. A non-zero exit
     * is a failure carrying the output. `input` is written to the command's stdin.
     */
    readonly run: (
        idOrName: string,
        cmd: string[],
        input?: string
    ) => Effect.Effect<ExecResult, DockerError>
    /**
     * Like `run`, but a non-zero exit is data, not a failure: scanners exit non-zero when they find
     * something. Never fails: a command that could not run reports `exitCode: -1` and the reason.
     */
    readonly capture: (
        idOrName: string,
        cmd: string[],
        input?: string
    ) => Effect.Effect<ExecResult>
}

/**
 * The one implementation of `ExecShape`.
 *
 * Declared at module scope rather than as a class expression on the service: declaration emit
 * cannot describe the private members of an anonymous exported class (TS4094).
 */
class ExecImpl implements ExecShape {
    constructor(private readonly client: Docker) {}

    /** One exec: create, start, collect the output, read the exit code. */
    private once(
        idOrName: string,
        cmd: string[],
        input: string | undefined,
        hijack: boolean,
        signal: AbortSignal
    ): Promise<ExecResult> {
        return (async () => {
            const exec = await this.client.getContainer(idOrName).exec({
                Cmd: cmd,
                AttachStdout: true,
                AttachStderr: true,
                AttachStdin: input !== undefined && input.length > 0,
                abortSignal: signal,
            })
            const hasInput = input !== undefined && input.length > 0
            const raw: unknown = await exec.start({
                hijack,
                stdin: hasInput,
                abortSignal: signal,
            })
            const exitCodeOf = async () => {
                const inspected = await exec.inspect()
                return typeof inspected.ExitCode === 'number'
                    ? inspected.ExitCode
                    : -1
            }

            const inline = extractInlineOutput(raw)
            if (inline !== null)
                return { exitCode: await exitCodeOf(), output: inline }
            if (!isWritableStream(raw) && !isReadableStream(raw)) {
                throw new Error(
                    'exec.start() returned an unexpected non-stream value'
                )
            }

            const stdout = new PassThrough()
            const stderr = new PassThrough()
            let output = ''
            try {
                this.client.modem.demuxStream(raw, stdout, stderr)
            } catch {
                // Not multiplexed: read the raw stream as stdout.
                raw.on('data', (chunk: Buffer) => stdout.write(chunk))
            }
            stdout.on(
                'data',
                (chunk: Buffer) => (output += chunk.toString('utf8'))
            )
            stderr.on(
                'data',
                (chunk: Buffer) => (output += chunk.toString('utf8'))
            )

            if (hasInput) {
                if (!isWritableStream(raw))
                    throw new Error(
                        'exec.start() returned a non-writable stream while stdin input was provided'
                    )
                raw.write(input)
                raw.end()
            }

            await new Promise<void>((resolve, reject) => {
                raw.on('end', resolve)
                raw.on('close', resolve)
                raw.on('error', reject)
            })
            return { exitCode: await exitCodeOf(), output }
        })()
    }

    /**
     * Some transports and proxies refuse the hijack upgrade (`HTTP code 101`) but stream fine
     * without it, so that one failure is retried once without hijack.
     */
    private attemptExec(
        idOrName: string,
        cmd: string[],
        input: string | undefined
    ) {
        return engineCall(`exec in container ${idOrName}`, (signal) =>
            this.once(idOrName, cmd, input, true, signal)
        ).pipe(
            Effect.catch((failure) =>
                /http code\s*101/i.test(engineMessage(failure.cause ?? failure))
                    ? engineCall(
                          `exec in container ${idOrName} (without hijack)`,
                          (signal) => this.once(idOrName, cmd, input, false, signal)
                      )
                    : Effect.fail(failure)
            )
        )
    }

    private startInteractive(
        exec: Docker.Exec,
        startOptions: { hijack: boolean; stdin: boolean },
        signal: AbortSignal
    ): Promise<unknown> {
        return (async () => {
            try {
                return await exec.start({
                    ...startOptions,
                    abortSignal: signal,
                })
            } catch {
                // Some daemons only hand the stream to the callback form.
                return await new Promise<unknown>((resolve, reject) => {
                    exec.start(startOptions, (error, stream) => {
                        if (error)
                            reject(
                                error instanceof Error
                                    ? error
                                    : new Error(String(error))
                            )
                        else resolve(stream)
                    })
                })
            }
        })()
    }

    interactive(
        idOrName: string,
        options: InteractiveExecOptions
    ): Effect.Effect<NodeJS.ReadWriteStream, DockerError> {
        return engineCall(
            `open an interactive shell in container ${idOrName}`,
            async (signal) => {
                const exec = await this.client.getContainer(idOrName).exec({
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    Tty: true,
                    Cmd: options.cmd,
                    User: options.user,
                    WorkingDir: options.workingDir,
                    Env: options.env,
                    abortSignal: signal,
                })
                const stream = await this.startInteractive(
                    exec,
                    { hijack: options.hijack, stdin: true },
                    signal
                )
                if (!isWritableStream(stream))
                    throw new Error(
                        'exec.start() did not return a duplex stream'
                    )
                return stream
            },
            `container '${idOrName}'`
        ).pipe(
            Effect.timeoutOrElse({
                duration: options.timeoutMs,
                orElse: () =>
                    Effect.fail(
                        new DockerUnavailable({
                            reason: `Timed out after ${String(options.timeoutMs)}ms opening a shell in container ${idOrName}`,
                        })
                    ),
            })
        )
    }

    run(
        idOrName: string,
        cmd: string[],
        input?: string
    ): Effect.Effect<ExecResult, DockerError> {
        const attempt = (id: string, c: string[], i: string | undefined) =>
            this.attemptExec(id, c, i)
        return Effect.fn('DockerExec.run')(function* () {
            const result = yield* attempt(idOrName, cmd, input)
            if (result.exitCode !== 0) {
                return yield* Effect.fail(
                    new DockerUnavailable({
                        reason: `Command ${cmd.join(' ')} failed with exit code ${String(result.exitCode)} - output: ${result.output}`,
                    })
                )
            }
            return result
        })()
    }

    capture(
        idOrName: string,
        cmd: string[],
        input?: string
    ): Effect.Effect<ExecResult> {
        const attempt = (id: string, c: string[], i: string | undefined) =>
            this.attemptExec(id, c, i)
        return Effect.fn('DockerExec.capture')(function* () {
            return yield* attempt(idOrName, cmd, input).pipe(
                Effect.catch((failure) =>
                    Effect.succeed({
                        exitCode: -1,
                        output: engineMessage(failure),
                    })
                )
            )
        })()
    }
}

/** Commands inside running containers, as an Effect service. */
export class Exec extends Context.Service<Exec, ExecShape>()('docker/Exec') {
    /** The implementation: it owns every member body and takes the engine client. */
    static readonly live = ExecImpl
}
