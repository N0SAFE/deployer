import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Exit, Fiber, Redacted, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandRunner } from "./command-runner";

const NODE = process.execPath;
const layer = CommandRunner.layer({ allow: [NODE, "definitely-not-a-real-binary"] });

const run = (args: readonly string[], options?: Parameters<CommandRunner["Service"]["run"]>[1], env?: Record<string, string | Redacted.Redacted>) =>
  Effect.gen(function* () {
    const runner = yield* CommandRunner;
    return yield* runner.run({ exe: NODE, args, ...(env === undefined ? {} : { env }) }, options);
  }).pipe(Effect.provide(layer));

const failureTag = <A, E>(exit: Exit.Exit<A, E>) => {
  if (!Exit.isFailure(exit)) return undefined;
  const failed = exit.cause.reasons.find((r) => r._tag === "Fail");
  return failed === undefined ? undefined : (failed.error as { _tag?: string })._tag;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("CommandRunner.run", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const result = await Effect.runPromise(
      run(["-e", "console.log('out'); console.error('err')"]),
    );
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
  });

  it("does NOT interpret shell metacharacters in arguments (no shell)", async () => {
    const marker = join(tmpdir(), `cmd-runner-injection-${String(process.pid)}-${String(Date.now())}`);
    const result = await Effect.runPromise(
      run(["-e", "console.log(process.argv[1])", `; touch ${marker} #`, `$(touch ${marker})`]),
    );
    expect(result.stdout).toContain("; touch");
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses an executable that is not on the allow-list", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* (yield* CommandRunner).run({ exe: "unzip", args: ["-q", "a.zip"] });
      }).pipe(Effect.provide(layer)),
    );
    expect(failureTag(exit)).toBe("ExeNotAllowed");
  });

  it("rejects NUL bytes in arguments", async () => {
    const exit = await Effect.runPromiseExit(run(["-e", "1", "a\0b"]));
    expect(failureTag(exit)).toBe("InvalidCommand");
  });

  it("reports a missing binary as SpawnFailed", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        return yield* (yield* CommandRunner).run({ exe: "definitely-not-a-real-binary", args: [] });
      }).pipe(Effect.provide(layer)),
    );
    expect(failureTag(exit)).toBe("SpawnFailed");
  });

  it("fails with CommandFailed on a non-zero exit and keeps a stderr tail", async () => {
    const exit = await Effect.runPromiseExit(
      run(["-e", "console.error('boom'); process.exit(3)"]),
    );
    expect(failureTag(exit)).toBe("CommandFailed");
    const error = Exit.isFailure(exit) ? (exit.cause.reasons.find((r) => r._tag === "Fail")?.error as { code: number; stderrTail: string }) : undefined;
    expect(error?.code).toBe(3);
    expect(error?.stderrTail).toContain("boom");
  });

  it("does not inherit the parent environment, and scrubs Redacted env values from errors and lines", async () => {
    vi.stubEnv("PARENT_ONLY_SECRET", "parent-secret-value");
    const lines: string[] = [];
    const exit = await Effect.runPromiseExit(
      run(
        [
          "-e",
          "console.log('has parent: ' + (process.env.PARENT_ONLY_SECRET !== undefined)); console.log('token=' + process.env.TOKEN); console.error('failed using ' + process.env.TOKEN); process.exit(1)",
        ],
        { onLine: (l) => lines.push(l.line) },
        { TOKEN: Redacted.make("ghp_supersecrettoken") },
      ),
    );
    vi.unstubAllEnvs();
    expect(lines).toContain("has parent: false");
    expect(lines.join("\n")).not.toContain("ghp_supersecrettoken");
    expect(lines).toContain("token=[redacted]");
    const error = Exit.isFailure(exit) ? (exit.cause.reasons.find((r) => r._tag === "Fail")?.error as { stderrTail: string }) : undefined;
    expect(error?.stderrTail).toContain("[redacted]");
    expect(error?.stderrTail).not.toContain("ghp_supersecrettoken");
  });

  it("enforces the output cap", async () => {
    const exit = await Effect.runPromiseExit(
      run(["-e", "process.stdout.write('x'.repeat(2_000_000))"], { maxOutputBytes: 10_000 }),
    );
    expect(failureTag(exit)).toBe("OutputTooLarge");
  });

  it("times out and kills the process", async () => {
    const exit = await Effect.runPromiseExit(
      run(["-e", "setInterval(() => {}, 1000)"], { timeout: "300 millis", killGrace: "200 millis" }),
    );
    expect(failureTag(exit)).toBe("CommandTimeout");
  });

  it("kills the whole process group (children included) when the fiber is interrupted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cmd-runner-"));
    const pidFile = join(dir, "child.pid");
    try {
      // The parent spawns a grandchild that outlives it unless the group is killed.
      const script = `
        const { spawn } = require('node:child_process');
        const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
        require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
        console.log('ready');
        setInterval(() => {}, 1000);
      `;
      const lines: string[] = [];
      const fiber = Effect.runFork(run(["-e", script], { onLine: (l) => lines.push(l.line), killGrace: "300 millis" }));
      for (let i = 0; i < 100 && !lines.includes("ready"); i++) await new Promise((r) => setTimeout(r, 50));
      expect(lines).toContain("ready");
      const grandchild = Number(await (await import("node:fs/promises")).readFile(pidFile, "utf8"));
      expect(alive(grandchild)).toBe(true);

      await Effect.runPromise(Fiber.interrupt(fiber));
      for (let i = 0; i < 40 && alive(grandchild); i++) await new Promise((r) => setTimeout(r, 50));
      expect(alive(grandchild)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CommandRunner.stream", () => {
  it("emits tagged lines and completes", async () => {
    const lines = await Effect.runPromise(
      Effect.gen(function* () {
        const runner = yield* CommandRunner;
        return yield* Stream.runCollect(
          runner.stream({ exe: NODE, args: ["-e", "console.log('a'); console.error('b'); console.log('c')"] }),
        );
      }).pipe(Effect.provide(layer)),
    );
    expect(lines.filter((l) => l.stream === "stdout").map((l) => l.line)).toEqual(["a", "c"]);
    expect(lines.filter((l) => l.stream === "stderr").map((l) => l.line)).toEqual(["b"]);
  });

  it("fails the stream with CommandFailed on a non-zero exit", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const runner = yield* CommandRunner;
        return yield* Stream.runCollect(runner.stream({ exe: NODE, args: ["-e", "console.log('x'); process.exit(2)"] }));
      }).pipe(Effect.provide(layer)),
    );
    expect(failureTag(exit)).toBe("CommandFailed");
  });
});

describe("CommandRunner.script (test double)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cmd-script-"));
    writeFileSync(join(dir, "x"), "x");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("replies by argv prefix and records every call", async () => {
    const { layer: scripted, calls } = CommandRunner.script([
      { match: ["git", "clone"], reply: { stdout: "cloned\n" } },
      { match: ["git"], reply: { stderr: "fatal\n", code: 128 } },
    ]);
    const program = Effect.gen(function* () {
      const runner = yield* CommandRunner;
      const ok = yield* runner.run({ exe: "git", args: ["clone", "--", "https://example.test/r.git", "dest"], cwd: dir });
      const bad = yield* Effect.flip(runner.run({ exe: "git", args: ["status"] }));
      const unmatched = yield* Effect.flip(runner.run({ exe: "docker", args: ["ps"] }));
      return { ok, bad, unmatched };
    }).pipe(Effect.provide(scripted));
    const { ok, bad, unmatched } = await Effect.runPromise(program);
    expect(ok.stdout).toBe("cloned\n");
    expect(bad._tag).toBe("CommandFailed");
    expect(unmatched._tag).toBe("SpawnFailed");
    expect(calls.map((c) => [c.exe, ...c.args])).toEqual([
      ["git", "clone", "--", "https://example.test/r.git", "dest"],
      ["git", "status"],
      ["docker", "ps"],
    ]);
    expect(calls[0]?.cwd).toBe(dir);
  });
});
