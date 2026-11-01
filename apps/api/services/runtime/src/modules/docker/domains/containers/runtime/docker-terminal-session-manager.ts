/**
 * The terminal sessions of containers: opening a shell on the engine, streaming its output, sending input and closing
 * it. The sessions are live state (a stream, a replay subject and a retain timer each), kept in one manager that the
 * Effect service holds as a singleton; the manager takes the engine the session is opened on.
 */
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { ReplaySubject } from "rxjs";
import type {
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import { dockerTerminalProfileSchema, type DockerTerminalProfile } from "@deployer/contracts-entities";
import type { DockerEngineShape } from "@deployer/docker";

import { execInContainer } from "./container-exec";
import {
  TERMINAL_SESSION_RETAIN_MS,
  buildInteractiveShellCommand,
  emitTerminalEvent,
  escapeShellArg,
  formatError,
  isReadWriteStream,
  isRecoverableAttachError,
  normalizeContainerPath,
  openTerminalStream,
  resolveContainerWorkingDir,
  toTerminalChunk,
  type TerminalSession,
  type TerminalSessionEvent,
} from "./container-runtime-helpers";

export class TerminalSessionManager {
  private readonly terminalSessions = new Map<string, TerminalSession>();
  private readonly terminalSessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** The sessions this replica holds, open or retained for replay: the keys it announces on the mesh. */
  sessionIds(): string[] {
    return [...this.terminalSessions.keys()];
  }

  shutdown(): void {
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

  async openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput, engine: DockerEngineShape) {
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
      engine,
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
    const exec = session.engine.exec;

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
        const { output } = await execInContainer(
          session.engine,
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
      await this.assertContainerDirectoryExists(session.engine, session.containerId, resolvedTarget);
      session.workingDir = resolvedTarget;
      emitTerminalEvent(session, "status", `cwd: ${session.workingDir}`);
    } catch {
      emitTerminalEvent(session, "error", `cd: ${requestedTarget || "~"}: No such file or directory`);
    }

    return true;
  }

  private async assertContainerDirectoryExists(engine: DockerEngineShape, containerId: string, directory: string): Promise<void> {
    await execInContainer(engine, containerId, [
      "sh",
      "-lc",
      `test -d ${escapeShellArg(directory)}`,
    ]);
  }

  /** Runs `command` in the container; a non-zero exit is a failure carrying the output. */
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

}
