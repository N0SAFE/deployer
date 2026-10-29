/**
 * What this node answers when another node asks over the mesh: each request is one local operation, and its answer
 * names this node. Pure over a set of local operations, so the answer shapes are tested with fakes.
 */
import type {
  DockerContainerListRequestPayload,
  DockerContainerListResponsePayload,
  DockerContainerInspectResponsePayload,
  DockerRuntimeCatalogResponsePayload,
} from "./docker-container-mesh.contracts";
import type {
  DockerContainerCreateDirectoryRequestPayload,
  DockerContainerDeletePathRequestPayload,
  DockerContainerFilesSnapshot,
  DockerContainerFilesSnapshotRequestPayload,
  DockerContainerLogsSnapshot,
  DockerContainerLogsSnapshotRequestPayload,
  DockerContainerMutationAck,
  DockerContainerProcessLogsSnapshotRequestPayload,
  DockerContainerProcessesSnapshot,
  DockerContainerProcessesSnapshotRequestPayload,
  DockerContainerReadFileSnapshot,
  DockerContainerReadFileSnapshotRequestPayload,
  DockerContainerRenamePathRequestPayload,
  DockerContainerTerminalCloseRequestPayload,
  DockerContainerTerminalEventsRequestPayload,
  DockerContainerTerminalEventsSnapshot,
  DockerContainerTerminalInputRequestPayload,
  DockerContainerTerminalOpenRequestPayload,
  DockerContainerTerminalOpenResult,
  DockerContainerWriteFileRequestPayload,
  DockerImageInspectRequestPayload,
} from "./docker-container-runtime-mesh.contracts";
import type { DockerContainerInspectDetail, DockerImageInspectDetail } from "@deployer/contracts-entities";

type Ack = DockerContainerMutationAck;
type Input<P> = { payload: P };

/** The local operations the mesh asks of this node (each already running on the app's Effect runtime). */
export type LocalNodeOperations = {
  readonly listContainers: (
    query: DockerContainerListRequestPayload["query"],
  ) => Promise<Pick<DockerContainerListResponsePayload, "data" | "meta">>;
  readonly getLocalDockerDaemonId: () => Promise<string | null>;
  readonly inspectContainer: (containerId: string) => Promise<DockerContainerInspectDetail>;
  readonly getRuntimeCatalogSnapshot: () => Promise<DockerRuntimeCatalogResponsePayload["catalog"]>;
  readonly inspectImage: (imageId: string) => Promise<DockerImageInspectDetail>;
  readonly logsSnapshot: (query: DockerContainerLogsSnapshotRequestPayload["query"]) => Promise<DockerContainerLogsSnapshot>;
  readonly processes: (query: DockerContainerProcessesSnapshotRequestPayload["query"]) => Promise<DockerContainerProcessesSnapshot>;
  readonly processLogsSnapshot: (
    query: DockerContainerProcessLogsSnapshotRequestPayload["query"],
  ) => Promise<DockerContainerLogsSnapshot>;
  readonly listFiles: (query: DockerContainerFilesSnapshotRequestPayload["query"]) => Promise<DockerContainerFilesSnapshot>;
  readonly readFile: (query: DockerContainerReadFileSnapshotRequestPayload["query"]) => Promise<DockerContainerReadFileSnapshot>;
  readonly writeFile: (body: DockerContainerWriteFileRequestPayload["body"]) => Promise<Ack>;
  readonly deletePath: (body: DockerContainerDeletePathRequestPayload["body"]) => Promise<Ack>;
  readonly renamePath: (body: DockerContainerRenamePathRequestPayload["body"]) => Promise<Ack>;
  readonly createDirectory: (body: DockerContainerCreateDirectoryRequestPayload["body"]) => Promise<Ack>;
  readonly openTerminal: (body: DockerContainerTerminalOpenRequestPayload["body"]) => Promise<DockerContainerTerminalOpenResult>;
  readonly terminalEvents: (
    query: DockerContainerTerminalEventsRequestPayload["query"],
  ) => Promise<DockerContainerTerminalEventsSnapshot>;
  readonly sendTerminalInput: (body: DockerContainerTerminalInputRequestPayload["body"]) => Promise<Ack>;
  readonly closeTerminal: (body: DockerContainerTerminalCloseRequestPayload["body"]) => Promise<Ack>;
};

/** An answer that stops the mesh asking other nodes: the node that owns the container has spoken. */
const owned = <P>(payload: P) => ({ payload, stopPropagation: true as const });

export function buildMeshHandlers(local: LocalNodeOperations, responderNodeId: string) {
  return {
    container: {
      listContainers: async ({ payload }: Input<DockerContainerListRequestPayload>) => {
        const [result, daemonId] = await Promise.all([local.listContainers(payload.query), local.getLocalDockerDaemonId()]);
        return { payload: { ...result, responderNodeId, responderDaemonId: daemonId } };
      },
      inspectContainer: async ({ payload }: Input<{ query: { containerId: string } }>) =>
        owned({ detail: await local.inspectContainer(payload.query.containerId), responderNodeId }),
      runtimeCatalog: async () => ({
        payload: { catalog: await local.getRuntimeCatalogSnapshot(), responderNodeId },
      }),
    },
    runtime: {
      logsSnapshot: async ({ payload }: Input<DockerContainerLogsSnapshotRequestPayload>) =>
        owned({ snapshot: await local.logsSnapshot(payload.query), responderNodeId }),
      processesSnapshot: async ({ payload }: Input<DockerContainerProcessesSnapshotRequestPayload>) =>
        owned({ snapshot: await local.processes(payload.query), responderNodeId }),
      processLogsSnapshot: async ({ payload }: Input<DockerContainerProcessLogsSnapshotRequestPayload>) =>
        owned({ snapshot: await local.processLogsSnapshot(payload.query), responderNodeId }),
      filesSnapshot: async ({ payload }: Input<DockerContainerFilesSnapshotRequestPayload>) =>
        owned({ snapshot: await local.listFiles(payload.query), responderNodeId }),
      readFileSnapshot: async ({ payload }: Input<DockerContainerReadFileSnapshotRequestPayload>) =>
        owned({ snapshot: await local.readFile(payload.query), responderNodeId }),
      writeFile: async ({ payload }: Input<DockerContainerWriteFileRequestPayload>) =>
        owned({ ack: await local.writeFile(payload.body), responderNodeId }),
      deletePath: async ({ payload }: Input<DockerContainerDeletePathRequestPayload>) =>
        owned({ ack: await local.deletePath(payload.body), responderNodeId }),
      renamePath: async ({ payload }: Input<DockerContainerRenamePathRequestPayload>) =>
        owned({ ack: await local.renamePath(payload.body), responderNodeId }),
      createDirectory: async ({ payload }: Input<DockerContainerCreateDirectoryRequestPayload>) =>
        owned({ ack: await local.createDirectory(payload.body), responderNodeId }),
      terminalOpen: async ({ payload }: Input<DockerContainerTerminalOpenRequestPayload>) =>
        owned({ session: await local.openTerminal(payload.body), responderNodeId }),
      terminalEvents: async ({ payload }: Input<DockerContainerTerminalEventsRequestPayload>) =>
        owned({ snapshot: await local.terminalEvents(payload.query), responderNodeId }),
      terminalInput: async ({ payload }: Input<DockerContainerTerminalInputRequestPayload>) =>
        owned({ ack: await local.sendTerminalInput(payload.body), responderNodeId }),
      terminalClose: async ({ payload }: Input<DockerContainerTerminalCloseRequestPayload>) =>
        owned({ ack: await local.closeTerminal(payload.body), responderNodeId }),
      imageInspect: async ({ payload }: Input<DockerImageInspectRequestPayload>) =>
        owned({ detail: await local.inspectImage(payload.query.imageId), responderNodeId }),
    },
  };
}

export type MeshHandlers = ReturnType<typeof buildMeshHandlers>;
