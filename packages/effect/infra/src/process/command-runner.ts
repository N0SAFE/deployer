import { Cause, Context, Data, Duration, Effect, Layer, Queue, Redacted, type Scope, Stream } from "effect";

/** The executable is not on this consumer's allow-list. */
export class ExeNotAllowed extends Data.TaggedError("ExeNotAllowed")<{ readonly exe: string }> {}
/** The command is structurally invalid (NUL byte in an argument, empty executable, ...). */
export class InvalidCommand extends Data.TaggedError("InvalidCommand")<{ readonly reason: string }> {}
/** The process could not be started (missing binary, permissions, ...). */
export class SpawnFailed extends Data.TaggedError("SpawnFailed")<{
  readonly exe: string;
  readonly message: string;
}> {}
/** The process ran and exited non-zero (or was killed by a signal). Output tail is scrubbed of secrets. */
export class CommandFailed extends Data.TaggedError("CommandFailed")<{
  readonly exe: string;
  readonly code: number | null;
  readonly signal: string | number | null;
  readonly stderrTail: string;
}> {}
export class CommandTimeout extends Data.TaggedError("CommandTimeout")<{
  readonly exe: string;
  readonly afterMs: number;
}> {}
export class OutputTooLarge extends Data.TaggedError("OutputTooLarge")<{
  readonly exe: string;
  readonly limitBytes: number;
}> {}

export type CommandError =
  | ExeNotAllowed
  | InvalidCommand
  | SpawnFailed
  | CommandFailed
  | CommandTimeout
  | OutputTooLarge;

export type Command = {
  /** Bare name resolved through PATH, or an absolute path. Must be on the runner's allow-list. */
  readonly exe: string;
  /** Arguments are an array: there is no shell and no interpolation. */
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Extra environment. The parent environment is NOT inherited (only `PATH`), unless the layer opts in. */
  readonly env?: Readonly<Record<string, string | Redacted.Redacted>>;
  readonly stdin?: string | Uint8Array;
};

export type OutputLine = { readonly stream: "stdout" | "stderr"; readonly line: string };

export type RunOptions = {
  /** Default 10 minutes. */
  readonly timeout?: Duration.Input;
  /** Combined stdout+stderr cap. Default 8 MiB. */
  readonly maxOutputBytes?: number;
  /** Grace between SIGTERM and SIGKILL. Default 5 seconds. */
  readonly killGrace?: Duration.Input;
  /** Called per output line, with secrets scrubbed (build logs). */
  readonly onLine?: (line: OutputLine) => void;
};

export type CommandResult = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type CommandRunnerShape = {
  /** Run to completion. Interrupting the effect (cancel, timeout) kills the whole process group. */
  readonly run: (command: Command, options?: RunOptions) => Effect.Effect<CommandResult, CommandError>;
  /** Merged stdout/stderr lines. Closing or interrupting the stream kills the process group. Fails `CommandFailed` on a non-zero exit. */
  readonly stream: (command: Command, options?: Omit<RunOptions, "onLine">) => Stream.Stream<OutputLine, CommandError>;
};

export type CommandRunnerOptions = {
  /** The only executables this consumer may run, e.g. `["docker", "git"]`. */
  readonly allow: readonly string[];
  /** Inherit the whole parent environment (default false: only PATH is passed). */
  readonly inheritEnv?: boolean;
};

const DEFAULT_TIMEOUT = Duration.minutes(10);
const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;
const DEFAULT_KILL_GRACE = Duration.seconds(5);
const STDERR_TAIL_CHARS = 4096;
const MIN_SECRET_LENGTH = 4;

const unwrapEnv = (
  env: Command["env"],
  inheritEnv: boolean,
): { readonly env: Record<string, string>; readonly secrets: readonly string[] } => {
  const ambient = Object.entries(Bun.env).filter((entry): entry is [string, string] => entry[1] !== undefined);
  // PATH is the one ambient variable a child needs to resolve bare executable names.
  const out: Record<string, string> = Object.fromEntries(
    inheritEnv ? ambient : ambient.filter(([key]) => key === "PATH"),
  );
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") {
      out[key] = value;
    } else {
      const unwrapped = Redacted.value(value);
      out[key] = unwrapped;
      if (unwrapped.length >= MIN_SECRET_LENGTH) secrets.push(unwrapped);
    }
  }
  return { env: out, secrets };
};

const scrubWith = (secrets: readonly string[]) => (text: string): string =>
  secrets.reduce((acc, secret) => acc.split(secret).join("[redacted]"), text);

const validate = (command: Command, allow: ReadonlySet<string>): CommandError | undefined => {
  if (command.exe.length === 0) return new InvalidCommand({ reason: "empty executable" });
  if (!allow.has(command.exe)) return new ExeNotAllowed({ exe: command.exe });
  if (command.exe.includes("\0") || command.args.some((arg) => arg.includes("\0"))) {
    return new InvalidCommand({ reason: "NUL byte in command" });
  }
  return undefined;
};

type Proc = Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;

/**
 * `Bun.spawn` throws synchronously for a missing binary (ENOENT) or a bad cwd.
 * `detached: true` gives the child its own process group so the whole tree can be signalled.
 */
const spawnChild = (command: Command, env: Record<string, string>): Effect.Effect<Proc, SpawnFailed> =>
  Effect.try({
    try: () =>
      Bun.spawn([command.exe, ...command.args], {
        cwd: command.cwd,
        env,
        stdin: command.stdin === undefined ? "ignore" : typeof command.stdin === "string" ? new TextEncoder().encode(command.stdin) : command.stdin,
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      }) as Proc,
    catch: (cause) => new SpawnFailed({ exe: command.exe, message: cause instanceof Error ? cause.message : String(cause) }),
  });

/**
 * Signal the process group (`-pid`), falling back to the child alone. `process.kill` is the only way
 * to signal a group: `Subprocess#kill` targets just the direct child, which would leak grandchildren.
 */
const signalGroup = (proc: Proc, signal: NodeJS.Signals): void => {
  try {
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      /* already gone */
    }
  }
};

const hasExited = (proc: Proc): boolean => proc.exitCode !== null || proc.signalCode !== null;

/** SIGTERM the group, wait `grace`, then SIGKILL. Always reaps (waits for exit). Never fails. */
const terminate = (proc: Proc, grace: Duration.Input): Effect.Effect<void> =>
  Effect.promise(async () => {
    if (hasExited(proc)) {
      await proc.exited;
      return;
    }
    signalGroup(proc, "SIGTERM");
    const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(Duration.toMillis(grace)).then(() => false)]);
    if (!exited) {
      signalGroup(proc, "SIGKILL");
      await proc.exited;
    }
  });

/** Scoped process: killed (and reaped) when the scope closes, whether by success, failure or interruption. */
const acquire = (
  command: Command,
  inheritEnv: boolean,
  grace: Duration.Input,
): Effect.Effect<{ readonly proc: Proc; readonly scrub: (text: string) => string }, SpawnFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const { env, secrets } = unwrapEnv(command.env, inheritEnv);
    const proc = yield* Effect.acquireRelease(spawnChild(command, env), (p) => terminate(p, grace));
    return { proc, scrub: scrubWith(secrets) };
  });

/** Splits decoded text into lines and reports them. Keeps the last partial line until flushed. */
const lineSplitter = (stream: OutputLine["stream"], emit: (line: OutputLine) => void) => {
  let pending = "";
  return {
    push: (text: string) => {
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        emit({ stream, line: pending.slice(0, index).replace(/\r$/, "") });
        pending = pending.slice(index + 1);
        index = pending.indexOf("\n");
      }
    },
    flush: () => {
      if (pending.length > 0) emit({ stream, line: pending.replace(/\r$/, "") });
      pending = "";
    },
  };
};

/** Read a pipe to the end, handing each chunk to `onChunk`. A pipe torn down by a kill ends quietly. */
const pump = async (source: ReadableStream<Uint8Array>, onChunk: (chunk: Uint8Array) => void): Promise<void> => {
  const reader = source.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk(value);
    }
  } catch {
    /* stream cancelled by the kill */
  } finally {
    reader.releaseLock();
  }
};

const tail = (text: string): string => (text.length > STDERR_TAIL_CHARS ? text.slice(-STDERR_TAIL_CHARS) : text);

const failCause = <E>(error: E): Cause.Cause<E> => Cause.fail(error);

/**
 * Runs host commands: **no shell, no interpolation, explicit allow-list, no ambient
 * environment, bounded output, timeout, and the whole process group is killed on
 * interrupt**. It is the single audited place a service can execute something.
 *
 * Built on `Bun.spawn`. Replaces `execSync("unzip ... \"<file>\"")`-style code
 * (SEC-014 / DEPLOY-031) and the three ad-hoc spawn wrappers (docker service, swarm
 * bootstrap, mesh-agent).
 */
export class CommandRunner extends Context.Service<CommandRunner, CommandRunnerShape>()(
  "infra/CommandRunner",
) {
  static readonly layer = (options: CommandRunnerOptions): Layer.Layer<CommandRunner> => {
    const allow: ReadonlySet<string> = new Set(options.allow);
    const inheritEnv = options.inheritEnv === true;

    const run: CommandRunnerShape["run"] = (command, runOptions) => {
      const invalid = validate(command, allow);
      if (invalid !== undefined) return Effect.fail(invalid);
      const timeout = runOptions?.timeout ?? DEFAULT_TIMEOUT;
      const maxBytes = runOptions?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
      const grace = runOptions?.killGrace ?? DEFAULT_KILL_GRACE;

      return Effect.scoped(
        Effect.gen(function* () {
          const { proc, scrub } = yield* acquire(command, inheritEnv, grace);

          const state = { total: 0, overflow: false };
          const out: string[] = [];
          const err: string[] = [];
          const emit = (line: OutputLine) => runOptions?.onLine?.({ stream: line.stream, line: scrub(line.line) });
          const stdoutLines = lineSplitter("stdout", emit);
          const stderrLines = lineSplitter("stderr", emit);

          const drain = (source: ReadableStream<Uint8Array>, sink: string[], splitter: ReturnType<typeof lineSplitter>) => {
            const decoder = new TextDecoder();
            return pump(source, (chunk) => {
              if (state.overflow) return;
              state.total += chunk.length;
              if (state.total > maxBytes) {
                state.overflow = true;
                signalGroup(proc, "SIGKILL");
                return;
              }
              const text = decoder.decode(chunk, { stream: true });
              sink.push(text);
              splitter.push(text);
            });
          };

          yield* Effect.promise(() =>
            Promise.all([drain(proc.stdout, out, stdoutLines), drain(proc.stderr, err, stderrLines), proc.exited]),
          );
          stdoutLines.flush();
          stderrLines.flush();

          if (state.overflow) return yield* new OutputTooLarge({ exe: command.exe, limitBytes: maxBytes });

          const stderr = err.join("");
          if (proc.exitCode !== 0) {
            return yield* new CommandFailed({
              exe: command.exe,
              code: proc.exitCode,
              signal: proc.signalCode,
              stderrTail: scrub(tail(stderr)),
            });
          }
          return { code: 0, stdout: out.join(""), stderr } satisfies CommandResult;
        }),
      ).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.fail(new CommandTimeout({ exe: command.exe, afterMs: Duration.toMillis(timeout) })),
        }),
      );
    };

    const stream: CommandRunnerShape["stream"] = (command, runOptions) => {
      const invalid = validate(command, allow);
      if (invalid !== undefined) return Stream.fail(invalid);
      const grace = runOptions?.killGrace ?? DEFAULT_KILL_GRACE;
      const timeout = runOptions?.timeout ?? DEFAULT_TIMEOUT;
      const maxBytes = runOptions?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

      return Stream.callback<OutputLine, CommandError>((queue) =>
        Effect.gen(function* () {
          const { proc, scrub } = yield* acquire(command, inheritEnv, grace);
          const state = { total: 0, overflow: false };
          const emit = (line: OutputLine) => {
            Queue.offerUnsafe(queue, { stream: line.stream, line: scrub(line.line) });
          };
          const stdoutLines = lineSplitter("stdout", emit);
          const stderrLines = lineSplitter("stderr", emit);
          let stderrTail = "";

          const drain = (source: ReadableStream<Uint8Array>, splitter: ReturnType<typeof lineSplitter>, isStderr: boolean) => {
            const decoder = new TextDecoder();
            return pump(source, (chunk) => {
              if (state.overflow) return;
              state.total += chunk.length;
              if (state.total > maxBytes) {
                state.overflow = true;
                signalGroup(proc, "SIGKILL");
                return;
              }
              const text = decoder.decode(chunk, { stream: true });
              if (isStderr) stderrTail = tail(stderrTail + text);
              splitter.push(text);
            });
          };

          // Completion and the timeout are delivered through the queue; the scope kills the child on exit.
          void Promise.all([drain(proc.stdout, stdoutLines, false), drain(proc.stderr, stderrLines, true), proc.exited]).then(() => {
            stdoutLines.flush();
            stderrLines.flush();
            if (state.overflow) {
              Queue.failCauseUnsafe(queue, failCause(new OutputTooLarge({ exe: command.exe, limitBytes: maxBytes })));
            } else if (proc.exitCode !== 0) {
              Queue.failCauseUnsafe(
                queue,
                failCause(
                  new CommandFailed({
                    exe: command.exe,
                    code: proc.exitCode,
                    signal: proc.signalCode,
                    stderrTail: scrub(stderrTail),
                  }),
                ),
              );
            } else {
              Queue.endUnsafe(queue);
            }
          });
          const timer = setTimeout(() => {
            Queue.failCauseUnsafe(
              queue,
              failCause(new CommandTimeout({ exe: command.exe, afterMs: Duration.toMillis(timeout) })),
            );
            signalGroup(proc, "SIGTERM");
          }, Duration.toMillis(timeout));
          yield* Effect.addFinalizer(() => Effect.sync(() => { clearTimeout(timer); }));
        }),
      );
    };

    return Layer.succeed(CommandRunner, CommandRunner.of({ run, stream }));
  };

  /**
   * Scripted test double. Rules are matched in order on the argv prefix; the first
   * match replies. Every call is recorded (including rejected ones) so specs can
   * assert exact argv and cwd. No process is ever started.
   */
  static readonly script = (
    rules: readonly {
      readonly match: readonly string[];
      readonly reply: { readonly stdout?: string; readonly stderr?: string; readonly code?: number };
    }[],
  ): { readonly layer: Layer.Layer<CommandRunner>; readonly calls: Command[] } => {
    const calls: Command[] = [];
    const find = (command: Command) =>
      rules.find((rule) => {
        const argv = [command.exe, ...command.args];
        return rule.match.every((part, index) => argv[index] === part);
      });
    const run: CommandRunnerShape["run"] = (command, runOptions) => {
      calls.push(command);
      const rule = find(command);
      if (rule === undefined) {
        return Effect.fail(new SpawnFailed({ exe: command.exe, message: "no script rule matched" }));
      }
      const { stdout = "", stderr = "", code = 0 } = rule.reply;
      for (const line of stdout.split("\n").filter((l) => l.length > 0)) runOptions?.onLine?.({ stream: "stdout", line });
      for (const line of stderr.split("\n").filter((l) => l.length > 0)) runOptions?.onLine?.({ stream: "stderr", line });
      return code === 0
        ? Effect.succeed({ code, stdout, stderr })
        : Effect.fail(new CommandFailed({ exe: command.exe, code, signal: null, stderrTail: stderr }));
    };
    const stream: CommandRunnerShape["stream"] = (command) => {
      const lines: OutputLine[] = [];
      return Stream.unwrap(
        run(command, { onLine: (l) => lines.push(l) }).pipe(
          Effect.map(() => Stream.fromIterable(lines)),
          Effect.catch((error) => Effect.succeed(Stream.concat(Stream.fromIterable(lines), Stream.fail(error)))),
        ),
      );
    };
    return { layer: Layer.succeed(CommandRunner, CommandRunner.of({ run, stream })), calls };
  };
}
