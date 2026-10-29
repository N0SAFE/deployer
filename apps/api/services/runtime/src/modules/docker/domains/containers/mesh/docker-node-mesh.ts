import { randomUUID } from "node:crypto";

import type { ClientContext, ClientLink } from "@orpc/client";
import { relayLink } from "@deployer/mesh-client";

import type {
  DockerContainerCreateDirectoryRequestPayload,
  DockerContainerCreateDirectoryResponsePayload,
  DockerContainerDeletePathRequestPayload,
  DockerContainerDeletePathResponsePayload,
  DockerContainerFilesSnapshotRequestPayload,
  DockerContainerFilesSnapshotResponsePayload,
  DockerContainerInspectRequestPayload,
  DockerContainerInspectResponsePayload,
  DockerContainerListRequestPayload,
  DockerContainerListResponsePayload,
  DockerContainerLogsSnapshotRequestPayload,
  DockerContainerLogsSnapshotResponsePayload,
  DockerContainerProcessLogsSnapshotRequestPayload,
  DockerContainerProcessLogsSnapshotResponsePayload,
  DockerContainerProcessesSnapshotRequestPayload,
  DockerContainerProcessesSnapshotResponsePayload,
  DockerContainerReadFileSnapshotRequestPayload,
  DockerContainerReadFileSnapshotResponsePayload,
  DockerContainerRenamePathRequestPayload,
  DockerContainerRenamePathResponsePayload,
  DockerContainerTerminalCloseRequestPayload,
  DockerContainerTerminalCloseResponsePayload,
  DockerContainerTerminalEventsRequestPayload,
  DockerContainerTerminalEventsResponsePayload,
  DockerContainerTerminalInputRequestPayload,
  DockerContainerTerminalInputResponsePayload,
  DockerContainerTerminalOpenRequestPayload,
  DockerContainerTerminalOpenResponsePayload,
  DockerContainerWriteFileRequestPayload,
  DockerContainerWriteFileResponsePayload,
  DockerImageInspectRequestPayload,
  DockerImageInspectResponsePayload,
  DockerRuntimeCatalogRequestPayload,
  DockerRuntimeCatalogResponsePayload,
} from "./node-mesh-types";

/** How long a node is given to answer before the caller moves on without it. */
const DEFAULT_TIMEOUT_MS = 1_500;
const SERVICE = "runtime";
const CALL = { context: {} } as const;

export type NodeMeshOptions<TResponse> = {
  readonly timeoutMs?: number;
  /** Stop collecting as soon as this says the answers so far are enough. */
  readonly stopWhen?: (response: TResponse, collected: readonly TResponse[]) => boolean;
  readonly maxCollectedResponses?: number;
};

export type NodeMeshResult<TResponse> = {
  readonly correlationId: string;
  readonly responses: readonly TResponse[];
  readonly stoppedEarly: boolean;
  readonly reason: "timeout" | "killer_switch";
  readonly metrics: {
    readonly expectedResponders: number;
    readonly receivedResponses: number;
    readonly droppedResponses: number;
    readonly retryResponses: number;
    readonly maxLagMs: number;
    readonly avgLagMs: number;
    readonly timedOut: boolean;
  };
};

/** The link to this node's agent, filled in when the runtime joins the mesh. Without it the runtime is alone on its node. */
export type NodeMeshAgent = {
  link: ClientLink<ClientContext> | undefined;
  /** This process's replica id, so the nodes it asks exclude its own. */
  selfReplicaId: string;
};

/** DI token for the holder of the agent link. */
export const NODE_MESH_AGENT = Symbol("runtime:node-mesh-agent");

/** DI token for the node mesh the docker callers ask through. */
export const DOCKER_NODE_MESH = Symbol("runtime:docker-node-mesh");

type Replica = { readonly service: string; readonly replicaId: string; readonly nodeId: string };

/**
 * Asks the other nodes about their own docker engines, through this node's agent.
 *
 * Every method keeps the name, the arguments and the result shape of the topic mesh it replaces, so the code that merges
 * lists, dedupes by responder and falls back to the node that owns a container is unchanged. What differs is how a node
 * is reached: the agent routes by the key the runtime of each node announces (its container ids), and pins a call to a
 * node, which answers from its own engine only. A container is asked of the node that holds it first, and of the others
 * if that fails; a question with no owner (a list, a catalog) goes to every other node. Without an agent, or when nobody
 * answers, a method resolves with no responses, which is what a lone node always meant.
 */
export function dockerNodeMeshOver(holder: NodeMeshAgent) {
  const agent = () => holder.link;

  const replicas = async (link: ClientLink<ClientContext>): Promise<readonly Replica[]> => {
    const snapshot = (await link.call(["directory", "snapshot"], {}, CALL)) as { replicas: Replica[] };
    return snapshot.replicas.filter((replica) => replica.service === SERVICE);
  };

  const otherNodes = async (link: ClientLink<ClientContext>): Promise<readonly string[]> => {
    const all = await replicas(link);
    const self = all.find((replica) => replica.replicaId === holder.selfReplicaId)?.nodeId;
    return [...new Set(all.map((replica) => replica.nodeId))].filter((nodeId) => nodeId !== self);
  };

  /** The node that announced `key` (a container id) among the other nodes, if any. */
  const ownerOf = async (link: ClientLink<ClientContext>, key: string): Promise<string | undefined> => {
    try {
      const resolution = (await link.call(["directory", "resolve"], { service: SERVICE, key }, CALL)) as {
        reason: string;
        replica: Replica;
      };
      const self = (await replicas(link)).find((replica) => replica.replicaId === holder.selfReplicaId)?.nodeId;
      return resolution.reason === "key-holder" && resolution.replica.nodeId !== self ? resolution.replica.nodeId : undefined;
    } catch {
      return undefined;
    }
  };

  const callNode = async (
    link: ClientLink<ClientContext>,
    node: string,
    path: readonly string[],
    input: unknown,
    key?: string,
  ): Promise<unknown> => relayLink({ agent: link, target: { service: SERVICE, node, ...(key === undefined ? {} : { key }) } }).call([...path], input, CALL);

  /** Collects answers as they come, and stops at the first of: enough, wanted, everyone answered, out of time. */
  const gather = <TOutput, TResponse>(
    nodes: readonly string[],
    ask: (node: string) => Promise<TOutput>,
    toResponse: (output: TOutput, node: string) => TResponse,
    options: NodeMeshOptions<TResponse>,
    fallbackTimeoutMs: number,
  ): Promise<NodeMeshResult<TResponse>> =>
    new Promise((resolve) => {
      const startedAt = Date.now();
      const collected: TResponse[] = [];
      let settled = 0;
      let done = false;
      const timeoutMs = options.timeoutMs ?? fallbackTimeoutMs;

      const finish = (stoppedEarly: boolean, timedOut: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const lag = Date.now() - startedAt;
        resolve({
          correlationId: randomUUID(),
          responses: collected,
          stoppedEarly,
          reason: stoppedEarly ? "killer_switch" : "timeout",
          metrics: {
            expectedResponders: nodes.length,
            receivedResponses: collected.length,
            droppedResponses: 0,
            retryResponses: 0,
            maxLagMs: lag,
            avgLagMs: lag,
            timedOut,
          },
        });
      };

      const timer = setTimeout(() => finish(false, true), timeoutMs);
      timer.unref();
      if (nodes.length === 0) {
        finish(false, false);
        return;
      }
      for (const node of nodes) {
        ask(node).then(
          (output) => {
            if (done) return;
            const response = toResponse(output, node);
            collected.push(response);
            const enough = options.maxCollectedResponses !== undefined && collected.length >= options.maxCollectedResponses;
            if (enough || options.stopWhen?.(response, collected) === true) {
              finish(true, false);
            }
          },
          () => undefined,
        ).finally(() => {
          settled += 1;
          if (settled === nodes.length) finish(false, false);
        });
      }
    });

  const empty = <TResponse>(): NodeMeshResult<TResponse> => ({
    correlationId: randomUUID(),
    responses: [],
    stoppedEarly: false,
    reason: "timeout",
    metrics: { expectedResponders: 0, receivedResponses: 0, droppedResponses: 0, retryResponses: 0, maxLagMs: 0, avgLagMs: 0, timedOut: false },
  });

  /** A question for every other node. */
  const everywhere =
    <TRequest, TOutput, TResponse>(
      path: readonly string[],
      input: (request: TRequest) => unknown,
      toResponse: (output: TOutput, node: string) => TResponse,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    ) =>
    async (request: TRequest, options: NodeMeshOptions<TResponse> = {}): Promise<NodeMeshResult<TResponse>> => {
      const link = agent();
      if (link === undefined) return empty();
      try {
        const nodes = await otherNodes(link);
        return await gather(nodes, (node) => callNode(link, node, path, input(request)) as Promise<TOutput>, toResponse, options, timeoutMs);
      } catch {
        return empty();
      }
    };

  /** A question about a container: its owner first, every other node if the owner is unknown or fails. */
  const ofContainer =
    <TRequest, TOutput, TResponse>(
      path: readonly string[],
      key: (request: TRequest) => string,
      input: (request: TRequest) => unknown,
      toResponse: (output: TOutput, node: string) => TResponse,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    ) =>
    async (request: TRequest, options: NodeMeshOptions<TResponse> = {}): Promise<NodeMeshResult<TResponse>> => {
      const link = agent();
      if (link === undefined) return empty();
      try {
        const owner = await ownerOf(link, key(request));
        if (owner !== undefined) {
          const answered = await gather(
            [owner],
            (node) => callNode(link, node, path, input(request), key(request)) as Promise<TOutput>,
            toResponse,
            options,
            timeoutMs,
          );
          if (answered.responses.length > 0) return answered;
        }
        const nodes = (await otherNodes(link)).filter((node) => node !== owner);
        return await gather(nodes, (node) => callNode(link, node, path, input(request)) as Promise<TOutput>, toResponse, options, timeoutMs);
      } catch {
        return empty();
      }
    };

  const named = <T extends object>(node: string, body: T) => ({ ...body, responderNodeId: node });

  return {
    listContainersAcrossInstances: everywhere<DockerContainerListRequestPayload, { data: unknown[]; meta: unknown; daemonId: string | null }, DockerContainerListResponsePayload>(
      ["containers", "list"],
      (request) => request.query,
      (output, node) => ({ data: output.data, meta: output.meta, responderNodeId: node, responderDaemonId: output.daemonId }) as DockerContainerListResponsePayload,
    ),
    inspectContainerAcrossInstances: ofContainer<DockerContainerInspectRequestPayload, { detail: unknown }, DockerContainerInspectResponsePayload>(
      ["containers", "inspect"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => named(node, output) as DockerContainerInspectResponsePayload,
    ),
    listRuntimeCatalogAcrossInstances: everywhere<DockerRuntimeCatalogRequestPayload, { catalog: unknown }, DockerRuntimeCatalogResponsePayload>(
      ["containers", "catalog"],
      () => ({}),
      (output, node) => named(node, output) as DockerRuntimeCatalogResponsePayload,
      2_000,
    ),
    listContainerLogsSnapshotAcrossInstances: ofContainer<DockerContainerLogsSnapshotRequestPayload, unknown, DockerContainerLogsSnapshotResponsePayload>(
      ["runtime", "logs"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerLogsSnapshotResponsePayload,
    ),
    listContainerProcessesSnapshotAcrossInstances: ofContainer<DockerContainerProcessesSnapshotRequestPayload, unknown, DockerContainerProcessesSnapshotResponsePayload>(
      ["runtime", "processes"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerProcessesSnapshotResponsePayload,
    ),
    listContainerProcessLogsSnapshotAcrossInstances: ofContainer<DockerContainerProcessLogsSnapshotRequestPayload, unknown, DockerContainerProcessLogsSnapshotResponsePayload>(
      ["runtime", "processLogs"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerProcessLogsSnapshotResponsePayload,
    ),
    listContainerFilesSnapshotAcrossInstances: ofContainer<DockerContainerFilesSnapshotRequestPayload, unknown, DockerContainerFilesSnapshotResponsePayload>(
      ["runtime", "files"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerFilesSnapshotResponsePayload,
    ),
    readContainerFileSnapshotAcrossInstances: ofContainer<DockerContainerReadFileSnapshotRequestPayload, unknown, DockerContainerReadFileSnapshotResponsePayload>(
      ["runtime", "readFile"],
      (request) => request.query.containerId,
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerReadFileSnapshotResponsePayload,
    ),
    writeContainerFileAcrossInstances: ofContainer<DockerContainerWriteFileRequestPayload, unknown, DockerContainerWriteFileResponsePayload>(
      ["runtime", "writeFile"],
      (request) => request.body.containerId,
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerWriteFileResponsePayload,
    ),
    deleteContainerPathAcrossInstances: ofContainer<DockerContainerDeletePathRequestPayload, unknown, DockerContainerDeletePathResponsePayload>(
      ["runtime", "deletePath"],
      (request) => request.body.containerId,
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerDeletePathResponsePayload,
    ),
    renameContainerPathAcrossInstances: ofContainer<DockerContainerRenamePathRequestPayload, unknown, DockerContainerRenamePathResponsePayload>(
      ["runtime", "renamePath"],
      (request) => request.body.containerId,
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerRenamePathResponsePayload,
    ),
    createContainerDirectoryAcrossInstances: ofContainer<DockerContainerCreateDirectoryRequestPayload, unknown, DockerContainerCreateDirectoryResponsePayload>(
      ["runtime", "createDirectory"],
      (request) => request.body.containerId,
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerCreateDirectoryResponsePayload,
    ),
    openContainerTerminalSessionAcrossInstances: ofContainer<DockerContainerTerminalOpenRequestPayload, unknown, DockerContainerTerminalOpenResponsePayload>(
      ["runtime", "terminalOpen"],
      (request) => request.body.containerId,
      (request) => request.body,
      (output, node) => ({ session: output, responderNodeId: node }) as DockerContainerTerminalOpenResponsePayload,
    ),
    // A terminal session lives on the node that opened it, and sessions are not announced as keys: ask every other node.
    listContainerTerminalSessionEventsAcrossInstances: everywhere<DockerContainerTerminalEventsRequestPayload, unknown, DockerContainerTerminalEventsResponsePayload>(
      ["runtime", "terminalEvents"],
      (request) => request.query,
      (output, node) => ({ snapshot: output, responderNodeId: node }) as DockerContainerTerminalEventsResponsePayload,
    ),
    sendContainerTerminalInputAcrossInstances: everywhere<DockerContainerTerminalInputRequestPayload, unknown, DockerContainerTerminalInputResponsePayload>(
      ["runtime", "terminalInput"],
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerTerminalInputResponsePayload,
    ),
    closeContainerTerminalSessionAcrossInstances: everywhere<DockerContainerTerminalCloseRequestPayload, unknown, DockerContainerTerminalCloseResponsePayload>(
      ["runtime", "terminalClose"],
      (request) => request.body,
      (output, node) => ({ ack: output, responderNodeId: node }) as DockerContainerTerminalCloseResponsePayload,
    ),
    inspectImageAcrossInstances: everywhere<DockerImageInspectRequestPayload, { detail: unknown }, DockerImageInspectResponsePayload>(
      ["images", "inspect"],
      (request) => request.query,
      (output, node) => named(node, output) as DockerImageInspectResponsePayload,
    ),
  };
}

export type DockerNodeMesh = ReturnType<typeof dockerNodeMeshOver>;
