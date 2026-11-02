import path from "node:path";

import { Context, Effect } from "effect";

import type { DockerContainerLogEntry, DockerContainerProcessEntry, DockerFileEntry } from "@deployer/contracts-entities";
import { DockerEngine } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import type {
  DockerContainerCreateDirectoryBodyInput,
  DockerContainerDeletePathBodyInput,
  DockerContainerFilesQueryInput,
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerProcessesQueryInput,
  DockerContainerReadFileQueryInput,
  DockerContainerRenamePathBodyInput,
  DockerContainerWriteFileBodyInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";


import {
  buildFileListing,
  type FileMutationAck,
} from "./container-file-ops";
import { parseContainerLogEntries, parseContainerProcesses } from "./container-ops-parsing";
import { escapeShellArg, logMatchesProcess, normalizeContainerPath } from "./container-runtime-helpers";
import { DEFAULT_LOG_TAIL, type LogsCollector } from "./container-streams";

const toSeconds = (date: Date | undefined) => (date ? Math.max(0, Math.floor(date.getTime() / 1_000)) : undefined);

const ack = (): FileMutationAck => ({ ok: true as const, timestamp: new Date().toISOString() });

/** What the container operations need from the Effect context while they run. */
type Engine = DockerEngine["Service"];

const collectLogs = (engine: Engine, containerId: string): LogsCollector => (tail, since, until) =>
  runPromiseUnwrapped(
    engine.logs
      .read(containerId, { stdout: true, stderr: true, tail, since, until, timestamps: true })
      .pipe(Effect.map((raw) => parseContainerLogEntries(raw, containerId, new Date().toISOString()))),
  );

export type DockerContainerOpsShape = {
  /** A collector of this container's log snapshots, bound to the engine in the context. */
  readonly logsCollector: (containerId: string) => Effect.Effect<LogsCollector, never, DockerEngine>;
  readonly logsSnapshot: (
    input: DockerContainerLogsStreamQueryInput,
  ) => Effect.Effect<{ generatedAt: string; entries: DockerContainerLogEntry[] }, unknown, DockerEngine>;
  readonly processes: (
    input: DockerContainerProcessesQueryInput,
  ) => Effect.Effect<{ generatedAt: string; data: DockerContainerProcessEntry[] }, unknown, DockerEngine>;
  readonly processLogsSnapshot: (
    input: DockerContainerProcessLogsStreamQueryInput,
  ) => Effect.Effect<{ generatedAt: string; entries: DockerContainerLogEntry[] }, unknown, DockerEngine>;
  readonly listFiles: (input: DockerContainerFilesQueryInput) => Effect.Effect<
    { containerId: string; path: string; generatedAt: string; entries: DockerFileEntry[] },
    unknown,
    DockerEngine
  >;
  readonly readFile: (input: DockerContainerReadFileQueryInput) => Effect.Effect<
    { containerId: string; path: string; generatedAt: string; encoding: "utf8"; content: string },
    unknown,
    DockerEngine
  >;
  readonly writeFile: (input: DockerContainerWriteFileBodyInput) => Effect.Effect<FileMutationAck, unknown, DockerEngine>;
  readonly deletePath: (input: DockerContainerDeletePathBodyInput) => Effect.Effect<FileMutationAck, unknown, DockerEngine>;
  readonly renamePath: (input: DockerContainerRenamePathBodyInput) => Effect.Effect<FileMutationAck, unknown, DockerEngine>;
  readonly createDirectory: (
    input: DockerContainerCreateDirectoryBodyInput,
  ) => Effect.Effect<FileMutationAck, unknown, DockerEngine>;
};

const runShell = (containerId: string, script: string) =>
  Effect.flatMap(DockerEngine, (engine) => engine.exec.run(containerId, ["sh", "-lc", script]));

/**
 * Logs, processes and file operations of a container: a constant that yields the docker engine when an operation
 * runs. Every file operation is one shell command in the container, with each path quoted.
 */
export class DockerContainerOps extends Context.Service<DockerContainerOps, DockerContainerOpsShape>()(
  "runtime/DockerContainerOps",
) {
  static readonly live = class DockerContainerOpsImpl implements DockerContainerOpsShape {
    logsCollector = (containerId: string) => Effect.map(DockerEngine, (engine) => collectLogs(engine, containerId))

    logsSnapshot = (input: DockerContainerLogsStreamQueryInput) =>
      Effect.gen(function* () {
        const engine = yield* DockerEngine;
        const raw = yield* engine.logs.read(input.containerId, {
          stdout: true,
          stderr: true,
          tail: input.tail ?? DEFAULT_LOG_TAIL,
          since: toSeconds(input.since),
          until: toSeconds(input.until),
          timestamps: true,
        });
        const generatedAt = new Date().toISOString();
        return { generatedAt, entries: parseContainerLogEntries(raw, input.containerId, generatedAt) };
      })

    processes = (input: DockerContainerProcessesQueryInput) =>
      Effect.gen(function* () {
        const engine = yield* DockerEngine;
        const generatedAt = new Date().toISOString();
        const top = yield* engine.containers.top(input.containerId, "aux");
        return { generatedAt, data: parseContainerProcesses(top, generatedAt) };
      })

    processLogsSnapshot = (input: DockerContainerProcessLogsStreamQueryInput) =>
      Effect.gen(function* () {
        const engine = yield* DockerEngine;
        const raw = yield* engine.logs.read(input.containerId, {
          stdout: true,
          stderr: true,
          tail: input.tail ?? DEFAULT_LOG_TAIL,
          since: undefined,
          until: undefined,
          timestamps: true,
        });
        const generatedAt = new Date().toISOString();
        const entries = parseContainerLogEntries(raw, input.containerId, generatedAt);
        const pidNeedle = input.pid.toString();
        const matched = entries.filter((entry) => logMatchesProcess(entry.message, pidNeedle));
        return { generatedAt, entries: matched.length > 0 ? matched : entries };
      })

    listFiles = (input: DockerContainerFilesQueryInput) =>
      Effect.gen(function* () {
        const containerPath = normalizeContainerPath(input.path ?? "/");
        const { output } = yield* runShell(input.containerId, `ls -la ${escapeShellArg(containerPath)}`);
        return buildFileListing(input.containerId, containerPath, output, new Date().toISOString());
      })

    readFile = (input: DockerContainerReadFileQueryInput) =>
      Effect.gen(function* () {
        const containerPath = normalizeContainerPath(input.path);
        const maxBytes = input.maxBytes ?? 1_000_000;
        const { output } = yield* runShell(input.containerId, `head -c ${String(maxBytes)} ${escapeShellArg(containerPath)}`);
        return {
          containerId: input.containerId,
          path: containerPath,
          generatedAt: new Date().toISOString(),
          encoding: "utf8" as const,
          content: output,
        };
      })

    writeFile = (input: DockerContainerWriteFileBodyInput) =>
      Effect.gen(function* () {
        const containerPath = normalizeContainerPath(input.path);
        const encoded = Buffer.from(input.content, "utf8").toString("base64");
        const mkdirPrefix = input.createParents ? `mkdir -p ${escapeShellArg(path.posix.dirname(containerPath))} && ` : "";
        yield* runShell(
          input.containerId,
          `${mkdirPrefix}printf %s ${escapeShellArg(encoded)} | base64 -d > ${escapeShellArg(containerPath)}`,
        );
        return ack();
      })

    deletePath = (input: DockerContainerDeletePathBodyInput) =>
      Effect.as(runShell(input.containerId, `rm -rf ${escapeShellArg(normalizeContainerPath(input.path))}`), ack())

    renamePath = (input: DockerContainerRenamePathBodyInput) =>
      Effect.as(
        runShell(
          input.containerId,
          `mv ${escapeShellArg(normalizeContainerPath(input.path))} ${escapeShellArg(normalizeContainerPath(input.nextPath))}`,
        ),
        ack(),
      )

    createDirectory = (input: DockerContainerCreateDirectoryBodyInput) =>
      Effect.as(runShell(input.containerId, `mkdir -p ${escapeShellArg(normalizeContainerPath(input.path))}`), ack())
  };
}
