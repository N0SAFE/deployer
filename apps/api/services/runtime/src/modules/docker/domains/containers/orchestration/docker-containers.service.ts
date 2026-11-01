import { serviceOver, type Over } from "@deployer/effect-core";
import { Context, Effect } from "effect";

import type {
  DockerContainerCreateDirectoryBodyInput,
  DockerContainerDeletePathBodyInput,
  DockerContainerFilesQueryInput,
  DockerContainerLinkedListQueryInput,
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessesQueryInput,
  DockerContainerReadFileQueryInput,
  DockerContainerRenamePathBodyInput,
  DockerContainerRuntimeActionBodyInput,
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerWriteFileBodyInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";

import type { DockerContainersOrchestratorService } from "./docker-containers-orchestrator.service";

type Orchestrator = DockerContainersOrchestratorService;
type Resolved<K extends keyof Orchestrator> = Awaited<ReturnType<Orchestrator[K]>>;

/**
 * The container surface a handler may call, as an Effect service.
 *
 * The orchestrator stays a Promise Nest class (its terminal sessions hold state and its streams are RxJS), so it arrives
 * through a port — the same shape `CatalogLocalPort` uses for `DockerRepository`. What changes is visibility: a handler
 * now declares `DockerContainers` in its `R`, so the requirement gate audits the dependency instead of the orchestrator
 * reaching the app-wide runtime behind a Promise.
 *
 * Streams are not here: `streamContainerLogs`, `streamContainerProcesses`, `streamContainerProcessLogs` and
 * `streamContainerTerminalSession` stay on the orchestrator, which is the RxJS boundary.
 */
export class DockerContainersPort extends Context.Service<
  DockerContainersPort,
  Pick<
    Orchestrator,
    | "listContainersLinked"
    | "runContainerAction"
    | "listContainerLogs"
    | "listContainerProcesses"
    | "listContainerFiles"
    | "readContainerFile"
    | "writeContainerFile"
    | "deleteContainerPath"
    | "renameContainerPath"
    | "createContainerDirectory"
    | "openContainerTerminalSession"
    | "sendContainerTerminalInput"
    | "closeContainerTerminalSession"
  >
>()("runtime/DockerContainersPort") {}

/**
 * Every unary call as an Effect. Written out rather than derived: a conditional over the orchestrator's method keys
 * produced a `TYield` union `procedure(...).effect(...)` could not constrain, and the explicit signatures are what the
 * requirement gate reads anyway.
 */
export type DockerContainersShape = {
  readonly listLinked: (
    input: DockerContainerLinkedListQueryInput,
    platformRole: string | null,
  ) => Effect.Effect<Resolved<"listContainersLinked">, unknown>;
  readonly runAction: (input: DockerContainerRuntimeActionBodyInput) => Effect.Effect<Resolved<"runContainerAction">, unknown>;
  readonly listLogs: (input: DockerContainerLogsStreamQueryInput) => Effect.Effect<Resolved<"listContainerLogs">, unknown>;
  readonly listProcesses: (
    input: DockerContainerProcessesQueryInput,
  ) => Effect.Effect<Resolved<"listContainerProcesses">, unknown>;
  readonly listFiles: (input: DockerContainerFilesQueryInput) => Effect.Effect<Resolved<"listContainerFiles">, unknown>;
  readonly readFile: (input: DockerContainerReadFileQueryInput) => Effect.Effect<Resolved<"readContainerFile">, unknown>;
  readonly writeFile: (input: DockerContainerWriteFileBodyInput) => Effect.Effect<Resolved<"writeContainerFile">, unknown>;
  readonly deletePath: (
    input: DockerContainerDeletePathBodyInput,
  ) => Effect.Effect<Resolved<"deleteContainerPath">, unknown>;
  readonly renamePath: (
    input: DockerContainerRenamePathBodyInput,
  ) => Effect.Effect<Resolved<"renameContainerPath">, unknown>;
  readonly createDirectory: (
    input: DockerContainerCreateDirectoryBodyInput,
  ) => Effect.Effect<Resolved<"createContainerDirectory">, unknown>;
  readonly openTerminal: (
    input: DockerContainerTerminalOpenBodyInput,
  ) => Effect.Effect<Resolved<"openContainerTerminalSession">, unknown>;
  readonly sendTerminalInput: (
    input: DockerContainerTerminalInputBodyInput,
  ) => Effect.Effect<Resolved<"sendContainerTerminalInput">, unknown>;
  readonly closeTerminal: (
    input: DockerContainerTerminalCloseBodyInput,
  ) => Effect.Effect<Resolved<"closeContainerTerminalSession">, unknown>;
};

/** Everything a caller must be able to see for these calls to run. */
export type DockerContainersPorts = DockerContainersPort;

const attempt = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: (error) => error });

export class DockerContainers extends Context.Service<DockerContainers, Over<DockerContainersShape, DockerContainersPort>>()(
  "runtime/DockerContainers",
) {
  /** Stateless: the port is resolved on every call. */
  static readonly live: Over<DockerContainersShape, DockerContainersPort> = serviceOver(
    DockerContainersPort,
    (containers): DockerContainersShape => ({
      listLinked: (input, platformRole) => attempt(() => containers.listContainersLinked(input, platformRole)),
      runAction: (input) => attempt(() => containers.runContainerAction(input)),
      listLogs: (input) => attempt(() => containers.listContainerLogs(input)),
      listProcesses: (input) => attempt(() => containers.listContainerProcesses(input)),
      listFiles: (input) => attempt(() => containers.listContainerFiles(input)),
      readFile: (input) => attempt(() => containers.readContainerFile(input)),
      writeFile: (input) => attempt(() => containers.writeContainerFile(input)),
      deletePath: (input) => attempt(() => containers.deleteContainerPath(input)),
      renamePath: (input) => attempt(() => containers.renameContainerPath(input)),
      createDirectory: (input) => attempt(() => containers.createContainerDirectory(input)),
      openTerminal: (input) => attempt(() => containers.openContainerTerminalSession(input)),
      sendTerminalInput: (input) => attempt(() => containers.sendContainerTerminalInput(input)),
      closeTerminal: (input) => attempt(() => containers.closeContainerTerminalSession(input)),
    }),
  );
}
