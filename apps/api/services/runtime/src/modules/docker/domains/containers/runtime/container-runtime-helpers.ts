/**
 * The pure rules of running commands in a container: terminal session events, shell and path quoting, parsing
 * `ps` output and timestamped log lines, and recognising recoverable exec errors. No engine and no Nest, so they
 * are tested on plain strings.
 */
import { ReplaySubject, from } from "rxjs";
import type { ExecShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { dockerFileEntrySchema, type DockerFileEntry, type DockerTerminalProfile } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";
import path from "node:path";

export type TerminalSessionEvent = {
  sessionId: string;
  timestamp: string;
  type: "output" | "status" | "error";
  data: string;
}

export type TerminalSessionStoredEvent = {
  sequence: number;
} & TerminalSessionEvent

export type TerminalSessionStream = NodeJS.ReadWriteStream & {
  destroy: () => void;
};

export type TerminalSession = {
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

export const DEFAULT_REFRESH_INTERVAL_MS = 1_000;
export const DEFAULT_LOG_TAIL = 300;
export const MAX_SEEN_LOG_KEYS = 3_000;
export const TERMINAL_SESSION_HISTORY_LIMIT = 500;
export const TERMINAL_SESSION_RETAIN_MS = 60_000;
export const TERMINAL_ATTACH_TIMEOUT_MS = 8_000;

export function buildInteractiveShellCommand(
  shell: TerminalSession["shell"],
  workingDir: string,
): string[] {
  const escapedWorkingDir = escapeShellArg(workingDir);

  return [
    "sh",
    "-lc",
    `cd ${escapedWorkingDir} && exec ${shell} -i`,
  ];
}

export function emitTerminalEvent(
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

export function escapeShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function findTitleIndex(titles: string[], candidates: string[]): number {
  const candidateSet = new Set(candidates.map((candidate) => candidate.toUpperCase()));

  return titles.findIndex((title) => candidateSet.has(title.toUpperCase()));
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isExecUpgradeTransportError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("101")
    || message.includes("switching protocols")
    || message.includes("upgrade");
}

export function isReadWriteStream(value: unknown): value is TerminalSessionStream {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.write === "function"
    && typeof value.on === "function"
    && typeof value.destroy === "function"
  );
}

export function isRecoverableAttachError(error: unknown): boolean {
  if (isExecUpgradeTransportError(error) || isTimeoutError(error)) {
    return true;
  }

  const message = formatError(error).toLowerCase();
  return message.includes("socket")
    || message.includes("hijack")
    || message.includes("econnreset")
    || message.includes("econnaborted");
}

export function isTimeoutError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("timed out") || message.includes("timeout");
}

export function logMatchesProcess(message: string, pid: string): boolean {
  const pidRegex = new RegExp(`\\b${pid}\\b`, "u");
  const bracketRegex = new RegExp(`\\[${pid}\\]`, "u");

  return pidRegex.test(message) || bracketRegex.test(message);
}

export function mapProcessState(value: string): 'running' | 'sleeping' | 'idle' | 'stopped' | 'zombie' {
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

export function normalizeContainerPath(inputPath: string): string {
  const normalized = path.posix.normalize(inputPath.trim());

  if (!normalized.startsWith("/")) {
    return `/${normalized}`;
  }

  return normalized;
}

export async function openTerminalStream(
  exec: ExecShape,
  session: TerminalSession,
  hijack: boolean,
): Promise<unknown> {
  return await runPromiseUnwrapped(
    exec.interactive(session.containerId, {
      cmd: buildInteractiveShellCommand(session.shell, session.workingDir),
      user: session.user,
      workingDir: session.workingDir,
      env: ["TERM=xterm-256color"],
      hijack,
      timeoutMs: TERMINAL_ATTACH_TIMEOUT_MS,
    }),
  );
}

export function parseListEntry(line: string, basePath: string, generatedAt: string): DockerFileEntry | null {
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

export function parsePercent(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(100, parsed));
}

export function parseTimestampedLogLine(line: string, fallbackTimestamp: string): { timestamp: string; message: string } {
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

export function resolveContainerWorkingDir(session: TerminalSession, requestedTarget: string): string {
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
    return normalizeContainerPath(path.posix.join(baseHome, homeRelative));
  }

  if (target.startsWith("/")) {
    return normalizeContainerPath(target);
  }

  return normalizeContainerPath(path.posix.resolve(session.workingDir, target));
}

export function toTerminalChunk(chunk: unknown): string {
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
