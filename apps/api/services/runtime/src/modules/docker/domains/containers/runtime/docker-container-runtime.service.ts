import { type OnModuleDestroy, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Observable, ReplaySubject, from, interval, startWith, switchMap } from "rxjs";
import type { ExecShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import type Docker from "dockerode";
import type {
  DockerContainerCreateDirectoryBodyInput,
  DockerContainerDeletePathBodyInput,
  DockerContainerFilesQueryInput,
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerProcessesQueryInput,
  DockerContainerProcessesStreamQueryInput,
  DockerContainerReadFileQueryInput,
  DockerContainerRenamePathBodyInput,
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
  DockerContainerWriteFileBodyInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import {
  dockerContainerLogEntrySchema,
  dockerContainerProcessEntrySchema,
  dockerContainerProcessStateSchema,
  dockerFileEntrySchema,
  dockerTerminalProfileSchema,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
  type DockerFileEntry,
  type DockerTerminalProfile,
} from "@deployer/contracts-entities";
import type { DockerEngineShape } from "@deployer/docker";
import { isRecord, isObjectLike } from "@deployer/type-guards"



import { DEFAULT_REFRESH_INTERVAL_MS, DEFAULT_LOG_TAIL, MAX_SEEN_LOG_KEYS, TERMINAL_SESSION_RETAIN_MS, emitTerminalEvent, escapeShellArg, findTitleIndex, formatError, isReadWriteStream, isRecoverableAttachError, logMatchesProcess, mapProcessState, normalizeContainerPath, openTerminalStream, parseListEntry, parsePercent, parseTimestampedLogLine, resolveContainerWorkingDir, toTerminalChunk } from "./container-runtime-helpers";
import type { TerminalSessionEvent, TerminalSession } from "./container-runtime-helpers";

export class DockerContainerRuntimeService implements OnModuleDestroy {
  private readonly terminalSessions = new Map<string, TerminalSession>();
  private readonly terminalSessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly dockerEngine: DockerEngineShape) {}

  /**
   * Lifecycle hook: when the NestJS application shuts down, close every
   * active terminal session and clear every pending cleanup timer so we
   * don't leave dangling Docker exec streams, ReplaySubject subscribers,
   * or setTimeout handles holding the event loop open.
   */
  onModuleDestroy(): void {
    // 1. Destroy active streams + complete ReplaySubjects for all open sessions
    for (const session of this.terminalSessions.values()) {
      try {
        if (session.stream) {
          session.stream.destroy();
        }
      } catch {
        // Ignore — the stream may already be closed/errored.
      }
      session.stream = null;
      try {
        session.events.complete();
      } catch {
        // ReplaySubject.complete() is idempotent — safe to ignore.
      }
    }

    // 2. Clear every per-session retain timer (no further deletes will run)
    for (const timer of this.terminalSessionCleanupTimers.values()) {
      clearTimeout(timer);
    }

    this.terminalSessionCleanupTimers.clear();
    this.terminalSessions.clear();
  }

  streamContainerLogs(input: DockerContainerLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    const refreshIntervalMs = input.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    const tail = input.tail ?? DEFAULT_LOG_TAIL;
    const initialSinceSeconds = input.since
      ? Math.max(0, Math.floor(input.since.getTime() / 1_000))
      : undefined;
    const untilSeconds = input.until
      ? Math.max(0, Math.floor(input.until.getTime() / 1_000))
      : undefined;

    return new Observable((subscriber) => {
      const seenKeys: string[] = [];
      const seenSet = new Set<string>();
      let nextSinceSeconds: number | undefined = initialSinceSeconds;

      const subscription = interval(refreshIntervalMs)
        .pipe(
          startWith(0),
          switchMap(() => from(this.collectContainerLogsSnapshot(input.containerId, tail, nextSinceSeconds, untilSeconds))),
        )
        .subscribe({
          next: (entries) => {
            for (const entry of entries) {
              const seenKey = `${entry.timestamp}|${entry.stream}|${entry.message}`;
              if (seenSet.has(seenKey)) {
                continue;
              }

              seenSet.add(seenKey);
              seenKeys.push(seenKey);

              if (seenKeys.length > MAX_SEEN_LOG_KEYS) {
                const oldest = seenKeys.shift();
                if (oldest) {
                  seenSet.delete(oldest);
                }
              }

              subscriber.next(entry);
            }

            const latestEntryTimestamp = entries
              .map((entry) => Date.parse(entry.timestamp))
              .filter((value) => Number.isFinite(value))
              .sort((a, b) => b - a)[0];

            if (typeof latestEntryTimestamp === "number") {
              const candidateSince = Math.max(0, Math.floor(latestEntryTimestamp / 1_000) - 1);
              nextSinceSeconds = typeof nextSinceSeconds === "number"
                ? Math.max(nextSinceSeconds, candidateSince)
                : candidateSince;
            }
          },
          error: (error) => { subscriber.error(error); },
        });

      return () => {
        subscription.unsubscribe();
      };
    });
  }

  async listContainerLogsSnapshot(input: DockerContainerLogsStreamQueryInput) {
    const sinceSeconds = input.since
      ? Math.max(0, Math.floor(input.since.getTime() / 1_000))
      : undefined;
    const untilSeconds = input.until
      ? Math.max(0, Math.floor(input.until.getTime() / 1_000))
      : undefined;

    const entries = await this.collectContainerLogsSnapshot(
      input.containerId,
      input.tail ?? DEFAULT_LOG_TAIL,
      sinceSeconds,
      untilSeconds,
    );

    return {
      generatedAt: new Date().toISOString(),
      entries,
    };
  }

  async listContainerProcesses(input: DockerContainerProcessesQueryInput) {
    const generatedAt = new Date().toISOString();
    const data = await this.collectContainerProcesses(input.containerId, generatedAt);

    return {
      generatedAt,
      data,
    };
  }

  streamContainerProcesses(input: DockerContainerProcessesStreamQueryInput) {
    const refreshIntervalMs = input.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;

    return interval(refreshIntervalMs).pipe(
      startWith(0),
      switchMap(() => from(this.listContainerProcesses({ containerId: input.containerId }))),
    );
  }

  streamContainerProcessLogs(input: DockerContainerProcessLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    const pidNeedle = input.pid.toString();

    return new Observable((subscriber) => {
      let subscription: { unsubscribe(): void } | undefined;
      let disposed = false;

      void this.collectContainerLogsSnapshot(
        input.containerId,
        Math.min(input.tail ?? DEFAULT_LOG_TAIL, 200),
        undefined,
      )
        .then((sampleEntries) => {
          const hasPidCorrelatedEntries = sampleEntries.some((entry) => logMatchesProcess(entry.message, pidNeedle));

          if (disposed || subscriber.closed) {
            return;
          }

          subscription = this.streamContainerLogs({
            containerId: input.containerId,
            tail: input.tail,
            refreshIntervalMs: input.refreshIntervalMs,
          }).subscribe({
            next: (entry) => {
              if (!hasPidCorrelatedEntries || logMatchesProcess(entry.message, pidNeedle)) {
                subscriber.next(entry);
              }
            },
            error: (error) => { subscriber.error(error); },
          });
        })
        .catch((error) => {
          if (!disposed && !subscriber.closed) {
            subscriber.error(error);
          }
        });

      return () => {
        disposed = true;
        subscription?.unsubscribe();
      };
    });
  }

  async listContainerProcessLogsSnapshot(input: DockerContainerProcessLogsStreamQueryInput) {
    const pidNeedle = input.pid.toString();
    const entries = await this.collectContainerLogsSnapshot(
      input.containerId,
      input.tail ?? DEFAULT_LOG_TAIL,
      undefined,
    );

    const matchedEntries = entries.filter((entry) => logMatchesProcess(entry.message, pidNeedle));

    return {
      generatedAt: new Date().toISOString(),
      entries: matchedEntries.length > 0 ? matchedEntries : entries,
    };
  }

  async listContainerFiles(input: DockerContainerFilesQueryInput) {
    const containerPath = normalizeContainerPath(input.path ?? "/");
    const pathArg = escapeShellArg(containerPath);

    const command = [
      "sh",
      "-lc",
      `ls -la ${pathArg}`,
    ];

    const { output } = await this.execInContainer(input.containerId, command);
    const generatedAt = new Date().toISOString();

    const entries = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith("total "))
      .map((line) => parseListEntry(line, containerPath, generatedAt))
      .filter((entry): entry is DockerFileEntry => entry !== null);

    return {
      containerId: input.containerId,
      path: containerPath,
      generatedAt,
      entries,
    };
  }

  async readContainerFile(input: DockerContainerReadFileQueryInput) {
    const containerPath = normalizeContainerPath(input.path);
    const maxBytes = input.maxBytes ?? 1_000_000;
    const pathArg = escapeShellArg(containerPath);

    const command = [
      "sh",
      "-lc",
      `head -c ${String(maxBytes)} ${pathArg}`,
    ];

    const { output } = await this.execInContainer(input.containerId, command);

    return {
      containerId: input.containerId,
      path: containerPath,
      generatedAt: new Date().toISOString(),
      encoding: "utf8" as const,
      content: output,
    };
  }

  async writeContainerFile(input: DockerContainerWriteFileBodyInput) {
    const containerPath = normalizeContainerPath(input.path);
    const encoded = Buffer.from(input.content, "utf8").toString("base64");

    const mkdirPrefix = input.createParents
      ? `mkdir -p ${escapeShellArg(path.posix.dirname(containerPath))} && `
      : "";

    const command = [
      "sh",
      "-lc",
      `${mkdirPrefix}printf %s ${escapeShellArg(encoded)} | base64 -d > ${escapeShellArg(containerPath)}`,
    ];

    await this.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async deleteContainerPath(input: DockerContainerDeletePathBodyInput) {
    const containerPath = normalizeContainerPath(input.path);
    const command = [
      "sh",
      "-lc",
      `rm -rf ${escapeShellArg(containerPath)}`,
    ];

    await this.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async renameContainerPath(input: DockerContainerRenamePathBodyInput) {
    const sourcePath = normalizeContainerPath(input.path);
    const nextPath = normalizeContainerPath(input.nextPath);

    const command = [
      "sh",
      "-lc",
      `mv ${escapeShellArg(sourcePath)} ${escapeShellArg(nextPath)}`,
    ];

    await this.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async createContainerDirectory(input: DockerContainerCreateDirectoryBodyInput) {
    const containerPath = normalizeContainerPath(input.path);

    const command = [
      "sh",
      "-lc",
      `mkdir -p ${escapeShellArg(containerPath)}`,
    ];

    await this.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    const shell = input.shell ?? "sh";
    const user = input.user ?? "root";
    const workingDir = normalizeContainerPath(input.workingDir ?? "/");
    const openedAt = new Date().toISOString();
    const sessionId = randomUUID();

    const profiles: DockerTerminalProfile[] = [
      dockerTerminalProfileSchema.parse({
        shell,
        user,
        workingDir,
        recommended: true,
      }),
      dockerTerminalProfileSchema.parse({
        shell: shell === "sh" ? "bash" : "sh",
        user,
        workingDir,
        recommended: false,
      }),
    ];

    const events = new ReplaySubject<TerminalSessionEvent>(200);

    const session: TerminalSession = {
      sessionId,
      containerId: input.containerId,
      shell,
      user,
      workingDir,
      profiles,
      openedAt,
      events,
      eventSequence: 0,
      eventHistory: [],
      stream: null,
      mode: "stream",
      queue: Promise.resolve(),
      attachPromise: null,
      closed: false,
    };

    this.terminalSessions.set(sessionId, session);

    emitTerminalEvent(session, "status", `Opening terminal session on ${input.containerId}...`);
    session.attachPromise = this.initializeTerminalSession(session);

    return {
      sessionId,
      containerId: input.containerId,
      shell,
      user,
      workingDir,
      profiles,
      openedAt,
    };
  }

  streamContainerTerminalSession(input: DockerContainerTerminalStreamQueryInput) {
    const session = this.getTerminalSessionOrThrow(input.sessionId);
    return session.events.asObservable();
  }

  listContainerTerminalSessionEvents(input: { sessionId: string; afterSequence?: number }) {
    const session = this.getTerminalSessionOrThrow(input.sessionId);
    const afterSequence = input.afterSequence ?? 0;

    return {
      sessionId: session.sessionId,
      generatedAt: new Date().toISOString(),
      closed: session.closed,
      latestSequence: session.eventSequence,
      events: session.eventHistory.filter((event) => event.sequence > afterSequence),
    };
  }

  async sendContainerTerminalInput(input: DockerContainerTerminalInputBodyInput) {
    const session = this.getTerminalSessionOrThrow(input.sessionId);
    if (session.closed) {
      throw new NotFoundException(`Terminal session '${input.sessionId}' not found`);
    }

    session.queue = session.queue
      .then(async () => {
        if (session.attachPromise) {
          await session.attachPromise;
        }

        await this.writeTerminalInput(session, input.input);
      })
      .catch((error) => {
        emitTerminalEvent(session, "error", formatError(error));
      });

    await session.queue;

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async closeContainerTerminalSession(input: DockerContainerTerminalCloseBodyInput) {
    const session = this.getTerminalSessionOrThrow(input.sessionId);
    if (session.closed) {
      return {
        ok: true as const,
        timestamp: new Date().toISOString(),
      };
    }

    this.finalizeTerminalSession(session, {
      statusMessage: "Session closed",
      destroyStream: true,
    });

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  private async attachTerminalStream(session: TerminalSession): Promise<"stream" | "command"> {
    const exec = this.dockerEngine.exec;

    let rawStream: unknown;
    try {
      rawStream = await openTerminalStream(exec, session, true);
    } catch (error) {
      if (isRecoverableAttachError(error)) {
        emitTerminalEvent(
          session,
          "status",
          "Interactive terminal attach failed; retrying with compatibility transport...",
        );

        try {
          rawStream = await openTerminalStream(exec, session, false);
        } catch (fallbackError) {
          emitTerminalEvent(
            session,
            "status",
            "Interactive terminal transport unavailable; switched to compatibility command mode",
          );
          emitTerminalEvent(session, "error", formatError(fallbackError));
          return "command";
        }
      } else {
        throw error;
      }
    }

    if (!isReadWriteStream(rawStream)) {
      emitTerminalEvent(session, "status", "Interactive terminal stream unavailable; switched to command mode");
      return "command";
    }

    if (session.closed) {
      try {
        rawStream.destroy();
      } catch {
        // Ignore stream destruction errors when session already closed.
      }

      return "command";
    }

    session.stream = rawStream;

    emitTerminalEvent(session, "status", `Connected to ${session.containerId} as ${session.user} (${session.shell})`);

    rawStream.on("data", (chunk) => {
      const data = toTerminalChunk(chunk);
      if (data.length === 0) {
        return;
      }

      emitTerminalEvent(session, "output", data);
    });

    rawStream.on("error", (error) => {
      this.finalizeTerminalSession(session, {
        errorMessage: formatError(error),
        statusMessage: "Terminal stream error",
        destroyStream: false,
      });
    });

    rawStream.on("end", () => {
      this.finalizeTerminalSession(session, {
        statusMessage: "Shell exited",
        destroyStream: false,
      });
    });

    rawStream.on("close", () => {
      this.finalizeTerminalSession(session, {
        statusMessage: "Shell closed",
        destroyStream: false,
      });
    });

    return "stream";
  }

  private async initializeTerminalSession(session: TerminalSession): Promise<void> {
    try {
      const mode = await this.attachTerminalStream(session);
      session.mode = mode;
    } catch (error) {
      this.finalizeTerminalSession(session, {
        errorMessage: formatError(error),
        statusMessage: "Failed to open shell session",
        destroyStream: true,
      });
    } finally {
      session.attachPromise = null;
    }
  }

  private async writeTerminalInput(session: TerminalSession, input: string): Promise<void> {
    if (input.length === 0) {
      return;
    }

    if (session.mode === "command") {
      await this.executeCommandModeInput(session, input);
      return;
    }

    if (!session.stream) {
      throw new NotFoundException(`Terminal session '${session.sessionId}' is not active`);
    }

    const stream = session.stream;

    await new Promise<void>((resolve, reject) => {
      stream.write(input, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async executeCommandModeInput(session: TerminalSession, input: string): Promise<void> {
    const commands = input
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (commands.length === 0) {
      return;
    }

    for (const command of commands) {
      if (command === "exit" || command === "logout") {
        this.finalizeTerminalSession(session, {
          statusMessage: "Shell exited",
          destroyStream: false,
        });
        return;
      }

      emitTerminalEvent(session, "status", `$ ${command}`);

      const handledBuiltin = await this.handleCommandModeBuiltin(session, command);
      if (handledBuiltin) {
        continue;
      }

      const commandWithWorkingDir = `cd ${escapeShellArg(session.workingDir)} && ${command}`;

      try {
        const { output } = await this.execInContainer(
          session.containerId,
          ["sh", "-lc", commandWithWorkingDir],
        );

        if (output.length > 0) {
          emitTerminalEvent(session, "output", output);
        }
      } catch (error) {
        emitTerminalEvent(session, "error", formatError(error));
      }
    }
  }

  private async handleCommandModeBuiltin(session: TerminalSession, command: string): Promise<boolean> {
    const cdMatch = /^cd(?:\s+(.+))?$/u.exec(command);
    if (!cdMatch) {
      return false;
    }

    const requestedTarget = (cdMatch[1] ?? "~").trim();
    const resolvedTarget = resolveContainerWorkingDir(session, requestedTarget);

    try {
      await this.assertContainerDirectoryExists(session.containerId, resolvedTarget);
      session.workingDir = resolvedTarget;
      emitTerminalEvent(session, "status", `cwd: ${session.workingDir}`);
    } catch {
      emitTerminalEvent(session, "error", `cd: ${requestedTarget || "~"}: No such file or directory`);
    }

    return true;
  }

  private async assertContainerDirectoryExists(containerId: string, directory: string): Promise<void> {
    await this.execInContainer(containerId, [
      "sh",
      "-lc",
      `test -d ${escapeShellArg(directory)}`,
    ]);
  }

  /** Runs `command` in the container; a non-zero exit is a failure carrying the output. */
  private execInContainer(containerId: string, command: string[]) {
    return runPromiseUnwrapped(this.dockerEngine.exec.run(containerId, command));
  }

  private finalizeTerminalSession(
    session: TerminalSession,
    options: {
      statusMessage: string;
      errorMessage?: string;
      destroyStream: boolean;
    },
  ): void {
    if (session.closed) {
      return;
    }

    session.closed = true;

    if (options.errorMessage) {
      emitTerminalEvent(session, "error", options.errorMessage);
    }

    emitTerminalEvent(session, "status", options.statusMessage);

    if (options.destroyStream && session.stream) {
      try {
        session.stream.destroy();
      } catch {
        // Ignore stream destruction errors during teardown.
      }
    }

    session.stream = null;
    session.events.complete();

    const existingTimer = this.terminalSessionCleanupTimers.get(session.sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const cleanupTimer = setTimeout(() => {
      this.terminalSessionCleanupTimers.delete(session.sessionId);
      this.terminalSessions.delete(session.sessionId);
    }, TERMINAL_SESSION_RETAIN_MS);

    this.terminalSessionCleanupTimers.set(session.sessionId, cleanupTimer);
  }

  private getTerminalSessionOrThrow(sessionId: string): TerminalSession {
    const session = this.terminalSessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(`Terminal session '${sessionId}' not found`);
    }

    return session;
  }

  private async collectContainerLogsSnapshot(
    containerId: string,
    tail: number,
    sinceSeconds?: number,
    untilSeconds?: number,
  ): Promise<DockerContainerLogEntry[]> {
    const rawLogs = await runPromiseUnwrapped(this.dockerEngine.logs.read(containerId, {
      stdout: true,
      stderr: true,
      tail,
      since: sinceSeconds,
      until: untilSeconds,
      timestamps: true,
    }));

    const now = new Date().toISOString();

    return rawLogs
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => {
        const { timestamp, message } = parseTimestampedLogLine(line, now);
        const stream: DockerContainerLogEntry["stream"] = message.toLowerCase().includes("stderr") ? "stderr" : "stdout";
        const level: DockerContainerLogEntry["level"] =
          /\b(error|fatal|panic)\b/i.test(message)
            ? "error"
            : /\b(warn|warning)\b/i.test(message)
              ? "warn"
              : "info";

        return dockerContainerLogEntrySchema.parse({
          id: createHash("sha1").update(`${containerId}:${timestamp}:${message}:${String(index)}`).digest("hex"),
          timestamp,
          stream,
          level,
          message,
        });
      });
  }

  private async collectContainerProcesses(containerId: string, generatedAt: string): Promise<DockerContainerProcessEntry[]> {
    const topResult = await runPromiseUnwrapped(this.dockerEngine.containers.top(containerId, "aux"));

    const titles = topResult.Titles ?? [];
    const rows = topResult.Processes ?? [];

    const pidIndex = findTitleIndex(titles, ["PID"]);
    const userIndex = findTitleIndex(titles, ["USER"]);
    const cpuIndex = findTitleIndex(titles, ["%CPU", "CPU"]);
    const memIndex = findTitleIndex(titles, ["%MEM", "MEM"]);
    const statIndex = findTitleIndex(titles, ["STAT", "STATE"]);
    const startIndex = findTitleIndex(titles, ["START", "STARTED"]);
    const commandIndex = findTitleIndex(titles, ["COMMAND", "CMD"]);

    const parsed = rows
      .map((row) => {
        if (!Array.isArray(row)) {
          return null;
        }

        const pidRaw = pidIndex >= 0 ? row[pidIndex] : undefined;
        const pid = pidRaw ? Number(pidRaw) : Number.NaN;

        if (!Number.isInteger(pid) || pid < 0) {
          return null;
        }

        const statValue = statIndex >= 0 ? (row[statIndex] ?? "") : "";
        const state = mapProcessState(statValue);

        const command = commandIndex >= 0
          ? row.slice(commandIndex).join(" ").trim()
          : row[row.length - 1] ?? "process";

        return dockerContainerProcessEntrySchema.parse({
          pid,
          user: (userIndex >= 0 ? row[userIndex] : undefined) ?? "unknown",
          cpuPercent: parsePercent(cpuIndex >= 0 ? row[cpuIndex] : undefined),
          memoryPercent: parsePercent(memIndex >= 0 ? row[memIndex] : undefined),
          state,
          startedAt: (startIndex >= 0 ? row[startIndex] : undefined) ?? generatedAt,
          command,
        });
      })
      .filter((entry): entry is DockerContainerProcessEntry => entry !== null);

    return parsed;
  }

}
