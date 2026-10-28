import { Duration, Effect, type Scope } from "effect";
import { SpawnFailed } from "./errors";
import { Command } from "./types";
import { scrubWith, unwrapEnv } from "./environment";

export type Proc = Bun.Subprocess<"ignore" | "pipe", "pipe", "pipe">;

/**
 * `Bun.spawn` throws synchronously for a missing binary (ENOENT) or a bad cwd.
 * `detached: true` gives the child its own process group so the whole tree can be signalled.
 */
export const spawnChild = (command: Command, env: Record<string, string>): Effect.Effect<Proc, SpawnFailed> =>
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
export const signalGroup = (proc: Proc, signal: NodeJS.Signals): void => {
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

export const hasExited = (proc: Proc): boolean => proc.exitCode !== null || proc.signalCode !== null;

/** SIGTERM the group, wait `grace`, then SIGKILL. Always reaps (waits for exit). Never fails. */
export const terminate = (proc: Proc, grace: Duration.Input): Effect.Effect<void> =>
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
export const acquire = (
  command: Command,
  inheritEnv: boolean,
  grace: Duration.Input,
): Effect.Effect<{ readonly proc: Proc; readonly scrub: (text: string) => string }, SpawnFailed, Scope.Scope> =>
  Effect.gen(function* () {
    const { env, secrets } = unwrapEnv(command.env, inheritEnv);
    const proc = yield* Effect.acquireRelease(spawnChild(command, env), (p) => terminate(p, grace));
    return { proc, scrub: scrubWith(secrets) };
  });
