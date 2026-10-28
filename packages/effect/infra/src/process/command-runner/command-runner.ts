import { Context, Duration, Effect, Layer, Queue, Stream } from "effect";
import { CommandError, CommandFailed, CommandTimeout, OutputTooLarge, SpawnFailed } from "./errors";
import { Command, CommandResult, CommandRunnerOptions, CommandRunnerShape, OutputLine } from "./types";
import { DEFAULT_KILL_GRACE, DEFAULT_MAX_OUTPUT, DEFAULT_TIMEOUT } from "./limits";
import { validate } from "./environment";
import { acquire, signalGroup } from "./process";
import { failCause, lineSplitter, pump, tail } from "./output";

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
