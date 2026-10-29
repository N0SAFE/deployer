import type { OnModuleDestroy } from "@nestjs/common";
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
import type { DockerContainerLogEntry } from "@deployer/contracts-entities";
import { runSyncUnwrapped } from "@deployer/effect-core";
import type { EffectRuntime } from "@deployer/nest-effect";
import { Effect } from "effect";
import { Observable, defer, from, switchMap } from "rxjs";

import { pollSnapshot, streamLogs, streamProcessLogs } from "./container-streams";
import { DockerContainerOps } from "./docker-container-ops";
import { DockerTerminalSessions } from "./docker-terminal-sessions";

/**
 * The Promise and Observable face of the container operations for Nest classes that are not on Effect yet. It holds
 * no logic: every call runs `DockerContainerOps` or `DockerTerminalSessions` on the app's Effect runtime, and the
 * streams are RxJS built from the snapshot collectors those services provide.
 */
export class DockerContainerRuntimeService implements OnModuleDestroy {
  constructor(private readonly runtime: Pick<EffectRuntime, "runPromiseUnwrapped">) {}

  private ops<A>(use: (ops: DockerContainerOps["Service"]) => Effect.Effect<A, unknown, DockerEngineRequirement>): Promise<A> {
    return this.runtime.runPromiseUnwrapped(
      Effect.gen(function* () {
        const ops = yield* DockerContainerOps;
        return yield* use(ops);
      }),
    );
  }

  private terminals<A>(use: (sessions: DockerTerminalSessions["Service"]) => Effect.Effect<A, unknown, DockerEngineRequirement>): Promise<A> {
    return this.runtime.runPromiseUnwrapped(
      Effect.gen(function* () {
        const sessions = yield* DockerTerminalSessions;
        return yield* use(sessions);
      }),
    );
  }

  /** A log collector for one container, resolved on the runtime so the stream polls without holding the context. */
  private collectorFor(containerId: string) {
    return from(this.ops((ops) => ops.logsCollector(containerId)));
  }

  onModuleDestroy(): void {
    runSyncUnwrapped(DockerTerminalSessions.live.shutdown);
  }

  streamContainerLogs(input: DockerContainerLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return this.collectorFor(input.containerId).pipe(
      switchMap((collect) => streamLogs(collect, input)),
    );
  }

  listContainerLogsSnapshot(input: DockerContainerLogsStreamQueryInput) {
    return this.ops((ops) => ops.logsSnapshot(input));
  }

  listContainerProcesses(input: DockerContainerProcessesQueryInput) {
    return this.ops((ops) => ops.processes(input));
  }

  streamContainerProcesses(input: DockerContainerProcessesStreamQueryInput) {
    return pollSnapshot(() => this.listContainerProcesses({ containerId: input.containerId }), input.refreshIntervalMs);
  }

  streamContainerProcessLogs(input: DockerContainerProcessLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return defer(() => this.collectorFor(input.containerId)).pipe(
      switchMap((collect) => streamProcessLogs(collect, input)),
    );
  }

  listContainerProcessLogsSnapshot(input: DockerContainerProcessLogsStreamQueryInput) {
    return this.ops((ops) => ops.processLogsSnapshot(input));
  }

  listContainerFiles(input: DockerContainerFilesQueryInput) {
    return this.ops((ops) => ops.listFiles(input));
  }

  readContainerFile(input: DockerContainerReadFileQueryInput) {
    return this.ops((ops) => ops.readFile(input));
  }

  writeContainerFile(input: DockerContainerWriteFileBodyInput) {
    return this.ops((ops) => ops.writeFile(input));
  }

  deleteContainerPath(input: DockerContainerDeletePathBodyInput) {
    return this.ops((ops) => ops.deletePath(input));
  }

  renameContainerPath(input: DockerContainerRenamePathBodyInput) {
    return this.ops((ops) => ops.renamePath(input));
  }

  createContainerDirectory(input: DockerContainerCreateDirectoryBodyInput) {
    return this.ops((ops) => ops.createDirectory(input));
  }

  openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    return this.terminals((sessions) => sessions.open(input));
  }

  /** Synchronous like the old API: an unknown session throws NotFound at the call, not on subscribe. */
  streamContainerTerminalSession(input: DockerContainerTerminalStreamQueryInput) {
    return runSyncUnwrapped(DockerTerminalSessions.live.stream(input));
  }

  listContainerTerminalSessionEvents(input: { sessionId: string; afterSequence?: number }) {
    return runSyncUnwrapped(DockerTerminalSessions.live.events(input));
  }

  sendContainerTerminalInput(input: DockerContainerTerminalInputBodyInput) {
    return this.terminals((sessions) => sessions.sendInput(input));
  }

  closeContainerTerminalSession(input: DockerContainerTerminalCloseBodyInput) {
    return this.terminals((sessions) => sessions.close(input));
  }
}

type DockerEngineRequirement = import("@deployer/docker").DockerEngine;
