import { DockerEngine } from "@deployer/docker";
import { Effect } from "effect";

import type { DockerRepository } from "../../../repositories/facade/docker.repository";
import { DockerContainerOps } from "../runtime/docker-container-ops";
import { DockerTerminalSessions } from "../runtime/docker-terminal-sessions";
import type { LocalNodeOperations } from "./mesh-handlers";

/** DI token for this node's local operations: the one set of answers both the old topic handlers and the node router serve. */
export const LOCAL_NODE_OPERATIONS = Symbol("runtime:local-node-operations");

/** Anything that runs an Effect for a Promise caller and rejects with the original failure (the app's Effect runtime). */
export type EffectPromiseRunner = {
  runPromiseUnwrapped: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>;
};

/**
 * This node's own operations, as the mesh asks for them: the container operations and terminal sessions run as
 * Effects on the app's runtime, and the engine reads go through the repository.
 */
export function makeLocalNodeOperations(
  runtime: EffectPromiseRunner,
  repository: Pick<
    DockerRepository,
    "listContainers" | "getLocalDockerDaemonId" | "inspectContainer" | "getRuntimeCatalogSnapshot" | "inspectImage"
  >,
): LocalNodeOperations {
  const ops = <A>(use: (ops: DockerContainerOps["Service"]) => Effect.Effect<A, unknown, DockerEngine>) =>
    runtime.runPromiseUnwrapped(Effect.flatMap(DockerContainerOps, use));
  const sessions = <A>(use: (sessions: DockerTerminalSessions["Service"]) => Effect.Effect<A, unknown, DockerEngine>) =>
    runtime.runPromiseUnwrapped(Effect.flatMap(DockerTerminalSessions, use));

  return {
    listContainers: (query) => repository.listContainers(query),
    getLocalDockerDaemonId: () => repository.getLocalDockerDaemonId(),
    inspectContainer: (containerId) => repository.inspectContainer(containerId),
    getRuntimeCatalogSnapshot: () => repository.getRuntimeCatalogSnapshot(),
    inspectImage: (imageId) => repository.inspectImage(imageId),
    logsSnapshot: (query) => ops((o) => o.logsSnapshot(query)),
    processes: (query) => ops((o) => o.processes(query)),
    processLogsSnapshot: (query) => ops((o) => o.processLogsSnapshot(query)),
    listFiles: (query) => ops((o) => o.listFiles(query)),
    readFile: (query) => ops((o) => o.readFile(query)),
    writeFile: (body) => ops((o) => o.writeFile(body)),
    deletePath: (body) => ops((o) => o.deletePath(body)),
    renamePath: (body) => ops((o) => o.renamePath(body)),
    createDirectory: (body) => ops((o) => o.createDirectory(body)),
    openTerminal: (body) => sessions((s) => s.open(body)),
    terminalEvents: (query) => runtime.runPromiseUnwrapped(Effect.flatMap(DockerTerminalSessions, (s) => s.events(query))),
    sendTerminalInput: (body) => runtime.runPromiseUnwrapped(Effect.flatMap(DockerTerminalSessions, (s) => s.sendInput(body))),
    closeTerminal: (body) => runtime.runPromiseUnwrapped(Effect.flatMap(DockerTerminalSessions, (s) => s.close(body))),
  };
}
