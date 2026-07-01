import { Injectable, type OnModuleDestroy, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Observable, ReplaySubject, from, interval, startWith, switchMap } from "rxjs";
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
} from "@repo/api-contracts/modules/docker/containers/shared";
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
} from "@repo/contracts-entities";
import { DockerService as CoreDockerService } from "@/core/modules/docker/services/docker.service";


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
interface TerminalSessionEvent {
  sessionId: string;
  timestamp: string;
  type: "output" | "status" | "error";
  data: string;
}

interface TerminalSessionStoredEvent extends TerminalSessionEvent {
  sequence: number;
}

type TerminalSessionStream = NodeJS.ReadWriteStream & {
  destroy: () => void;
};

interface TerminalSession {
  sessionId: string;
  containerId: string;
  shell: "bash" | "sh" | "zsh" | "ash";
  user: string;
  workingDir: string;
  profiles: DockerTerminalProfile[];
  openedAt: string;
  events: ReplaySubject<TerminalSessionEvent>;
  eventSequence: number;
  eventHistory: TerminalSessionStoredEvent[];
  stream: TerminalSessionStream | null;
  mode: "stream" | "command";
  queue: Promise<void>;
  attachPromise: Promise<void> | null;
  closed: boolean;
}

const DEFAULT_REFRESH_INTERVAL_MS = 1_000;
const DEFAULT_LOG_TAIL = 300;
const MAX_SEEN_LOG_KEYS = 3_000;
const TERMINAL_SESSION_HISTORY_LIMIT = 500;
const TERMINAL_SESSION_RETAIN_MS = 60_000;
const TERMINAL_ATTACH_TIMEOUT_MS = 8_000;

@Injectable()
export class DockerContainerRuntimeService implements OnModuleDestroy {
  private readonly terminalSessions = new Map<string, TerminalSession>();
  private readonly terminalSessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly coreDockerService: CoreDockerService) {}

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
          const hasPidCorrelatedEntries = sampleEntries.some((entry) => this.logMatchesProcess(entry.message, pidNeedle));

          if (disposed || subscriber.closed) {
            return;
          }

          subscription = this.streamContainerLogs({
            containerId: input.containerId,
            tail: input.tail,
            refreshIntervalMs: input.refreshIntervalMs,
          }).subscribe({
            next: (entry) => {
              if (!hasPidCorrelatedEntries || this.logMatchesProcess(entry.message, pidNeedle)) {
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

    const matchedEntries = entries.filter((entry) => this.logMatchesProcess(entry.message, pidNeedle));

    return {
      generatedAt: new Date().toISOString(),
      entries: matchedEntries.length > 0 ? matchedEntries : entries,
    };
  }

  async listContainerFiles(input: DockerContainerFilesQueryInput) {
    const containerPath = this.normalizeContainerPath(input.path ?? "/");
    const pathArg = this.escapeShellArg(containerPath);

    const command = [
      "sh",
      "-lc",
      `ls -la ${pathArg}`,
    ];

    const { output } = await this.coreDockerService.execInContainer(input.containerId, command);
    const generatedAt = new Date().toISOString();

    const entries = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => !line.startsWith("total "))
      .map((line) => this.parseListEntry(line, containerPath, generatedAt))
      .filter((entry): entry is DockerFileEntry => entry !== null);

    return {
      containerId: input.containerId,
      path: containerPath,
      generatedAt,
      entries,
    };
  }

  async readContainerFile(input: DockerContainerReadFileQueryInput) {
    const containerPath = this.normalizeContainerPath(input.path);
    const maxBytes = input.maxBytes ?? 1_000_000;
    const pathArg = this.escapeShellArg(containerPath);

    const command = [
      "sh",
      "-lc",
      `head -c ${String(maxBytes)} ${pathArg}`,
    ];

    const { output } = await this.coreDockerService.execInContainer(input.containerId, command);

    return {
      containerId: input.containerId,
      path: containerPath,
      generatedAt: new Date().toISOString(),
      encoding: "utf8" as const,
      content: output,
    };
  }

  async writeContainerFile(input: DockerContainerWriteFileBodyInput) {
    const containerPath = this.normalizeContainerPath(input.path);
    const encoded = Buffer.from(input.content, "utf8").toString("base64");

    const mkdirPrefix = input.createParents
      ? `mkdir -p ${this.escapeShellArg(path.posix.dirname(containerPath))} && `
      : "";

    const command = [
      "sh",
      "-lc",
      `${mkdirPrefix}printf %s ${this.escapeShellArg(encoded)} | base64 -d > ${this.escapeShellArg(containerPath)}`,
    ];

    await this.coreDockerService.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async deleteContainerPath(input: DockerContainerDeletePathBodyInput) {
    const containerPath = this.normalizeContainerPath(input.path);
    const command = [
      "sh",
      "-lc",
      `rm -rf ${this.escapeShellArg(containerPath)}`,
    ];

    await this.coreDockerService.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async renameContainerPath(input: DockerContainerRenamePathBodyInput) {
    const sourcePath = this.normalizeContainerPath(input.path);
    const nextPath = this.normalizeContainerPath(input.nextPath);

    const command = [
      "sh",
      "-lc",
      `mv ${this.escapeShellArg(sourcePath)} ${this.escapeShellArg(nextPath)}`,
    ];

    await this.coreDockerService.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async createContainerDirectory(input: DockerContainerCreateDirectoryBodyInput) {
    const containerPath = this.normalizeContainerPath(input.path);

    const command = [
      "sh",
      "-lc",
      `mkdir -p ${this.escapeShellArg(containerPath)}`,
    ];

    await this.coreDockerService.execInContainer(input.containerId, command);

    return {
      ok: true as const,
      timestamp: new Date().toISOString(),
    };
  }

  async openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    const shell = input.shell ?? "sh";
    const user = input.user ?? "root";
    const workingDir = this.normalizeContainerPath(input.workingDir ?? "/");
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

    this.emitTerminalEvent(session, "status", `Opening terminal session on ${input.containerId}...`);
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
        this.emitTerminalEvent(session, "error", this.formatError(error));
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
    const docker = this.coreDockerService.getDockerClient();
    const container = docker.getContainer(session.containerId);

    let rawStream: unknown;
    try {
      const primaryExec = await this.createTerminalExec(container, session);
      rawStream = await this.startTerminalExecStream(primaryExec, {
        hijack: true,
        stdin: true,
      });
    } catch (error) {
      if (this.isRecoverableAttachError(error)) {
        this.emitTerminalEvent(
          session,
          "status",
          "Interactive terminal attach failed; retrying with compatibility transport...",
        );

        try {
          const fallbackExec = await this.createTerminalExec(container, session);
          rawStream = await this.startTerminalExecStream(fallbackExec, {
            hijack: false,
            stdin: true,
          });
        } catch (fallbackError) {
          this.emitTerminalEvent(
            session,
            "status",
            "Interactive terminal transport unavailable; switched to compatibility command mode",
          );
          this.emitTerminalEvent(session, "error", this.formatError(fallbackError));
          return "command";
        }
      } else {
        throw error;
      }
    }

    if (!this.isReadWriteStream(rawStream)) {
      this.emitTerminalEvent(session, "status", "Interactive terminal stream unavailable; switched to command mode");
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

    this.emitTerminalEvent(session, "status", `Connected to ${session.containerId} as ${session.user} (${session.shell})`);

    rawStream.on("data", (chunk) => {
      const data = this.toTerminalChunk(chunk);
      if (data.length === 0) {
        return;
      }

      this.emitTerminalEvent(session, "output", data);
    });

    rawStream.on("error", (error) => {
      this.finalizeTerminalSession(session, {
        errorMessage: this.formatError(error),
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
        errorMessage: this.formatError(error),
        statusMessage: "Failed to open shell session",
        destroyStream: true,
      });
    } finally {
      session.attachPromise = null;
    }
  }

  private buildInteractiveShellCommand(
    shell: TerminalSession["shell"],
    workingDir: string,
  ): string[] {
    const escapedWorkingDir = this.escapeShellArg(workingDir);

    return [
      "sh",
      "-lc",
      `cd ${escapedWorkingDir} && exec ${shell} -i`,
    ];
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

      this.emitTerminalEvent(session, "status", `$ ${command}`);

      const handledBuiltin = await this.handleCommandModeBuiltin(session, command);
      if (handledBuiltin) {
        continue;
      }

      const commandWithWorkingDir = `cd ${this.escapeShellArg(session.workingDir)} && ${command}`;

      try {
        const { output } = await this.coreDockerService.execInContainer(
          session.containerId,
          ["sh", "-lc", commandWithWorkingDir],
        );

        if (output.length > 0) {
          this.emitTerminalEvent(session, "output", output);
        }
      } catch (error) {
        this.emitTerminalEvent(session, "error", this.formatError(error));
      }
    }
  }

  private async handleCommandModeBuiltin(session: TerminalSession, command: string): Promise<boolean> {
    const cdMatch = /^cd(?:\s+(.+))?$/u.exec(command);
    if (!cdMatch) {
      return false;
    }

    const requestedTarget = (cdMatch[1] ?? "~").trim();
    const resolvedTarget = this.resolveContainerWorkingDir(session, requestedTarget);

    try {
      await this.assertContainerDirectoryExists(session.containerId, resolvedTarget);
      session.workingDir = resolvedTarget;
      this.emitTerminalEvent(session, "status", `cwd: ${session.workingDir}`);
    } catch {
      this.emitTerminalEvent(session, "error", `cd: ${requestedTarget || "~"}: No such file or directory`);
    }

    return true;
  }

  private resolveContainerWorkingDir(session: TerminalSession, requestedTarget: string): string {
    const target = requestedTarget.length > 0 ? requestedTarget : "~";

    if (target === "~") {
      return session.user === "root"
        ? "/root"
        : path.posix.normalize(`/home/${session.user}`);
    }

    if (target.startsWith("~")) {
      const baseHome = session.user === "root"
        ? "/root"
        : path.posix.normalize(`/home/${session.user}`);
      const homeRelative = target.slice(1).replace(/^\/+/, "");
      return this.normalizeContainerPath(path.posix.join(baseHome, homeRelative));
    }

    if (target.startsWith("/")) {
      return this.normalizeContainerPath(target);
    }

    return this.normalizeContainerPath(path.posix.resolve(session.workingDir, target));
  }

  private async assertContainerDirectoryExists(containerId: string, directory: string): Promise<void> {
    await this.coreDockerService.execInContainer(containerId, [
      "sh",
      "-lc",
      `test -d ${this.escapeShellArg(directory)}`,
    ]);
  }

  private async createTerminalExec(container: Docker.Container, session: TerminalSession): Promise<Docker.Exec> {
    const shellCommand = this.buildInteractiveShellCommand(session.shell, session.workingDir);

    return container.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: shellCommand,
      User: session.user,
      WorkingDir: session.workingDir,
      Env: ["TERM=xterm-256color"],
    });
  }

  private async startTerminalExecStream(
    exec: Docker.Exec,
    options: {
      hijack: boolean;
      stdin: boolean;
    },
  ): Promise<unknown> {
    try {
      return await this.withTimeout(
        Promise.resolve(exec.start(options)),
        TERMINAL_ATTACH_TIMEOUT_MS,
      );
    } catch (error) {
      if (!this.isRecoverableAttachError(error)) {
        throw error;
      }

      return this.withTimeout(
        new Promise<unknown>((resolve, reject) => {
          try {
            exec.start(options, (callbackError, stream) => {
              if (callbackError) {
                reject(callbackError);
                return;
              }

              resolve(stream);
            });
          } catch (callbackStartError) {
            reject(callbackStartError);
          }
        }),
        TERMINAL_ATTACH_TIMEOUT_MS,
      );
    }
  }

  private emitTerminalEvent(
    session: TerminalSession,
    type: TerminalSessionEvent["type"],
    data: string,
  ): void {
    const event: TerminalSessionEvent = {
      sessionId: session.sessionId,
      timestamp: new Date().toISOString(),
      type,
      data,
    };

    const storedEvent: TerminalSessionStoredEvent = {
      ...event,
      sequence: session.eventSequence + 1,
    };

    session.eventSequence = storedEvent.sequence;
    session.eventHistory.push(storedEvent);
    if (session.eventHistory.length > TERMINAL_SESSION_HISTORY_LIMIT) {
      session.eventHistory.splice(0, session.eventHistory.length - TERMINAL_SESSION_HISTORY_LIMIT);
    }

    session.events.next(event);
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
      this.emitTerminalEvent(session, "error", options.errorMessage);
    }

    this.emitTerminalEvent(session, "status", options.statusMessage);

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

  private isReadWriteStream(value: unknown): value is TerminalSessionStream {
    if (!value || typeof value !== "object") {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.write === "function"
      && typeof record.on === "function"
      && typeof record.destroy === "function"
    );
  }

  private isExecUpgradeTransportError(error: unknown): boolean {
    const message = this.formatError(error).toLowerCase();
    return message.includes("101")
      || message.includes("switching protocols")
      || message.includes("upgrade");
  }

  private isRecoverableAttachError(error: unknown): boolean {
    if (this.isExecUpgradeTransportError(error) || this.isTimeoutError(error)) {
      return true;
    }

    const message = this.formatError(error).toLowerCase();
    return message.includes("socket")
      || message.includes("hijack")
      || message.includes("econnreset")
      || message.includes("econnaborted");
  }

  private isTimeoutError(error: unknown): boolean {
    const message = this.formatError(error).toLowerCase();
    return message.includes("timed out") || message.includes("timeout");
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race<T>([
        promise,
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`Operation timed out after ${String(timeoutMs)}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private toTerminalChunk(chunk: unknown): string {
    if (typeof chunk === "string") {
      return chunk;
    }

    if (Buffer.isBuffer(chunk)) {
      return chunk.toString("utf8");
    }

    if (chunk instanceof Uint8Array) {
      return Buffer.from(chunk).toString("utf8");
    }

    return "";
  }

  private async collectContainerLogsSnapshot(
    containerId: string,
    tail: number,
    sinceSeconds?: number,
    untilSeconds?: number,
  ): Promise<DockerContainerLogEntry[]> {
    const rawLogs = await this.coreDockerService.getContainerLogs(containerId, {
      stdout: true,
      stderr: true,
      tail,
      since: sinceSeconds,
      until: untilSeconds,
      timestamps: true,
    });

    const now = new Date().toISOString();

    return rawLogs
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => {
        const { timestamp, message } = this.parseTimestampedLogLine(line, now);
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

  private parseTimestampedLogLine(line: string, fallbackTimestamp: string): { timestamp: string; message: string } {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return {
        timestamp: fallbackTimestamp,
        message: trimmed,
      };
    }

    const firstSpaceIndex = trimmed.indexOf(" ");
    if (firstSpaceIndex <= 0) {
      return {
        timestamp: fallbackTimestamp,
        message: trimmed,
      };
    }

    const timestampCandidate = trimmed.slice(0, firstSpaceIndex);
    const maybeTimestamp = Number.isFinite(Date.parse(timestampCandidate))
      ? new Date(timestampCandidate).toISOString()
      : null;

    if (!maybeTimestamp) {
      return {
        timestamp: fallbackTimestamp,
        message: trimmed,
      };
    }

    return {
      timestamp: maybeTimestamp,
      message: trimmed.slice(firstSpaceIndex + 1).trimStart(),
    };
  }

  private async collectContainerProcesses(containerId: string, generatedAt: string): Promise<DockerContainerProcessEntry[]> {
    const docker = this.coreDockerService.getDockerClient();
    const container = docker.getContainer(containerId);

    const topResult = await container.top({ ps_args: "aux" });

    const titles = topResult.Titles ?? [];
    const rows = topResult.Processes ?? [];

    const pidIndex = this.findTitleIndex(titles, ["PID"]);
    const userIndex = this.findTitleIndex(titles, ["USER"]);
    const cpuIndex = this.findTitleIndex(titles, ["%CPU", "CPU"]);
    const memIndex = this.findTitleIndex(titles, ["%MEM", "MEM"]);
    const statIndex = this.findTitleIndex(titles, ["STAT", "STATE"]);
    const startIndex = this.findTitleIndex(titles, ["START", "STARTED"]);
    const commandIndex = this.findTitleIndex(titles, ["COMMAND", "CMD"]);

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
        const state = this.mapProcessState(statValue);

        const command = commandIndex >= 0
          ? row.slice(commandIndex).join(" ").trim()
          : row[row.length - 1] ?? "process";

        return dockerContainerProcessEntrySchema.parse({
          pid,
          user: (userIndex >= 0 ? row[userIndex] : undefined) ?? "unknown",
          cpuPercent: this.parsePercent(cpuIndex >= 0 ? row[cpuIndex] : undefined),
          memoryPercent: this.parsePercent(memIndex >= 0 ? row[memIndex] : undefined),
          state,
          startedAt: (startIndex >= 0 ? row[startIndex] : undefined) ?? generatedAt,
          command,
        });
      })
      .filter((entry): entry is DockerContainerProcessEntry => entry !== null);

    return parsed;
  }

  private findTitleIndex(titles: string[], candidates: string[]): number {
    const candidateSet = new Set(candidates.map((candidate) => candidate.toUpperCase()));

    return titles.findIndex((title) => candidateSet.has(title.toUpperCase()));
  }

  private parsePercent(value: string | undefined): number {
    if (!value) {
      return 0;
    }

    const parsed = Number(value.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return Math.max(0, Math.min(100, parsed));
  }

  private mapProcessState(value: string): 'running' | 'sleeping' | 'idle' | 'stopped' | 'zombie' {
    const statePrefix = value.trim().charAt(0).toUpperCase();

    switch (statePrefix) {
      case "R":
        return "running";
      case "S":
      case "D":
      case "I":
        return "sleeping";
      case "T":
        return "stopped";
      case "Z":
        return "zombie";
      default:
        return "idle";
    }
  }

  private parseListEntry(line: string, basePath: string, generatedAt: string): DockerFileEntry | null {
    const parts = line.split(/\s+/);
    if (parts.length < 9) {
      return null;
    }

    const permissions = parts[0] ?? "";
    const owner = parts[2] ?? "unknown";
    const sizeRaw = parts[4] ?? "0";
    const name = parts.slice(8).join(" ").trim();

    if (name === "." || name === ".." || name.length === 0) {
      return null;
    }

    const entryPath = path.posix.normalize(
      basePath === "/" ? `/${name}` : `${basePath}/${name}`,
    );

    return dockerFileEntrySchema.parse({
      path: entryPath,
      type: permissions.startsWith("d") ? "dir" : "file",
      size: `${sizeRaw} B`,
      permissions,
      owner,
      updatedAt: generatedAt,
    });
  }

  private normalizeContainerPath(inputPath: string): string {
    const normalized = path.posix.normalize(inputPath.trim());

    if (!normalized.startsWith("/")) {
      return `/${normalized}`;
    }

    return normalized;
  }

  private escapeShellArg(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  private logMatchesProcess(message: string, pid: string): boolean {
    const pidRegex = new RegExp(`\\b${pid}\\b`, "u");
    const bracketRegex = new RegExp(`\\[${pid}\\]`, "u");

    return pidRegex.test(message) || bracketRegex.test(message);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
