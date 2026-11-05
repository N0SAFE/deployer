import { Duration, Effect, Redacted, Stream } from 'effect'

import type { CommandError } from './errors'

export type Command = {
    /** Bare name resolved through PATH, or an absolute path. Must be on the runner's allow-list. */
    readonly exe: string
    /** Arguments are an array: there is no shell and no interpolation. */
    readonly args: readonly string[]
    readonly cwd?: string
    /** Extra environment. The parent environment is NOT inherited (only `PATH`), unless the layer opts in. */
    readonly env?: Readonly<Record<string, string | Redacted.Redacted>>
    readonly stdin?: string | Uint8Array
}

export type OutputLine = {
    readonly stream: 'stdout' | 'stderr'
    readonly line: string
}

export type RunOptions = {
    /** Default 10 minutes. */
    readonly timeout?: Duration.Input
    /** Combined stdout+stderr cap. Default 8 MiB. */
    readonly maxOutputBytes?: number
    /** Grace between SIGTERM and SIGKILL. Default 5 seconds. */
    readonly killGrace?: Duration.Input
    /** Called per output line, with secrets scrubbed (build logs). */
    readonly onLine?: (line: OutputLine) => void
}

export type CommandResult = {
    readonly code: number
    readonly stdout: string
    readonly stderr: string
}

export type CommandRunnerShape = {
    /** Run to completion. Interrupting the effect (cancel, timeout) kills the whole process group. */
    readonly run: (
        command: Command,
        options?: RunOptions
    ) => Effect.Effect<CommandResult, CommandError>
    /** Merged stdout/stderr lines. Closing or interrupting the stream kills the process group. Fails `CommandFailed` on a non-zero exit. */
    readonly stream: (
        command: Command,
        options?: Omit<RunOptions, 'onLine'>
    ) => Stream.Stream<OutputLine, CommandError>
}

export type CommandRunnerOptions = {
    /** The only executables this consumer may run, e.g. `["docker", "git"]`. */
    readonly allow: readonly string[]
    /** Inherit the whole parent environment (default false: only PATH is passed). */
    readonly inheritEnv?: boolean
}
