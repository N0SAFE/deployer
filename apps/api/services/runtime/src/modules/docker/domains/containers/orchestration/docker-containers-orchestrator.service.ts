import { Context, Effect } from "effect";

import {
  dockerContainerLinkPathSchema,
  type DockerContainerLinkPath,
} from "@deployer/contracts-entities";
import { DockerEngine } from "@deployer/docker";
import { AppError } from "@deployer/errors";
import { AppLogger } from "@deployer/logger";
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


import { DockerContainerLinks } from "../../../repositories/containers/links/docker-container-links";
import { DockerContainerAccess } from "../runtime/docker-container-access";

import { DockerContainerResolution } from "./docker-container-resolution";

import type { DockerContainerStreamsShape } from "../runtime/docker-container-streams";

/** The label the supervisors stamp on the containers they own. */
const PLATFORM_ROLE_LABEL = "deployer.platform.role";
/** What a caller may not do to a platform container. */
const PROTECTED_ACTIONS: ReadonlySet<string> = new Set(["stop", "restart", "pause", "kill", "remove"]);

const apiLogger = new AppLogger("api").scope("DockerContainersOrchestratorService");
const debugLogger = apiLogger.createContextFilterLogger({
  defaultClassName: "DockerContainersOrchestratorService",
  filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
  channel: "docker-containers-orchestrator",
});

const debug = (source: string, context?: Record<string, unknown>): void => {
  apiLogger.log.info(`[docker-containers-orchestrator] ${source}`, context ?? {});
  debugLogger.debug(source, context);
};

const parseIncludePaths = (include: string | undefined, maxDepth: number): DockerContainerLinkPath[] => {
  if (!include || include.trim().length === 0) {
    return [];
  }

  const normalizedDepth = Math.max(1, Math.min(3, maxDepth));

  const uniquePaths = new Set<DockerContainerLinkPath>();
  const tokens = include
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  for (const token of tokens) {
    const parsedPath = dockerContainerLinkPathSchema.safeParse(token);
    if (!parsedPath.success) {
      continue;
    }

    if (parsedPath.data.split(".").length <= normalizedDepth) {
      uniquePaths.add(parsedPath.data);
    }
  }

  return [...uniquePaths];
};

const makeUnary = () => ({
  listContainersLinked: (input: DockerContainerLinkedListQueryInput, platformRole: string | null) =>
    Effect.gen(function* () {
      debug("DockerContainersOrchestratorService.listContainersLinked", {
        limit: input.limit,
        offset: input.offset,
        include: input.include,
        maxDepth: input.maxDepth,
        platformRole,
      });

      const resolution = yield* DockerContainerResolution;
      const links = yield* DockerContainerLinks;

      const { include, maxDepth, ...listInput } = input;
      const containerList = yield* resolution.listContainers(listInput);
      const data = yield* links.attach(containerList.data, parseIncludePaths(include, maxDepth), platformRole);

      return {
        data,
        meta: containerList.meta,
      };
    }),

  runContainerAction: (input: DockerContainerRuntimeActionBodyInput) =>
    Effect.gen(function* () {
      debug("DockerContainersOrchestratorService.runContainerAction", {
        containerId: input.containerId,
        action: input.action,
      });

      const dockerEngine = yield* DockerEngine;

      // CLUSTER-004: a platform-managed container is owned by a supervisor. Stopping, killing or removing it from the
      // dashboard takes the ingress, database or agent down without the platform noticing, so those actions are refused.
      // Starting and unpausing stay allowed: they are recovery, not destruction.
      if (PROTECTED_ACTIONS.has(input.action)) {
        const info = yield* dockerEngine.containers.inspect(input.containerId).pipe(Effect.catch(() => Effect.succeed(null)));
        const managedBy = info?.Config?.Labels?.[PLATFORM_ROLE_LABEL];
        if (managedBy !== undefined && managedBy !== "") {
          return yield* Effect.fail(
            new AppError(
              `Container ${input.containerId} is managed by the platform (${managedBy}): ${input.action} is refused. ` +
                "Use the platform's own controls; a copy started by hand is not supervised.",
              "FORBIDDEN",
            ),
          );
        }
      }

      switch (input.action) {
        case "start": {
          yield* dockerEngine.containers.start(input.containerId);
          break;
        }
        case "stop": {
          yield* dockerEngine.containers.stop(input.containerId);
          break;
        }
        case "restart": {
          yield* dockerEngine.containers.restart(input.containerId);
          break;
        }
        case "pause": {
          yield* dockerEngine.containers.pause(input.containerId);
          break;
        }
        case "unpause": {
          yield* dockerEngine.containers.unpause(input.containerId);
          break;
        }
        case "kill": {
          yield* dockerEngine.containers.kill(input.containerId);
          break;
        }
        case "remove": {
          yield* dockerEngine.containers.remove(input.containerId);
          break;
        }
        default: {
          const exhaustiveCheck: never = input.action;
          return yield* Effect.die(new AppError(`Unsupported container action: ${String(exhaustiveCheck)}`, "INTERNAL_ERROR"));
        }
      }

      return {
        ok: true as const,
        containerId: input.containerId,
        action: input.action,
        timestamp: new Date(),
      };
    }),

  listContainerLogs: (input: DockerContainerLogsStreamQueryInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.listLogs(input)),

  listContainerProcesses: (input: DockerContainerProcessesQueryInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.listProcesses(input)),

  listContainerFiles: (input: DockerContainerFilesQueryInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.listFiles(input)),

  readContainerFile: (input: DockerContainerReadFileQueryInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.readFile(input)),

  writeContainerFile: (input: DockerContainerWriteFileBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.writeFile(input)),

  deleteContainerPath: (input: DockerContainerDeletePathBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.deletePath(input)),

  renameContainerPath: (input: DockerContainerRenamePathBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.renamePath(input)),

  createContainerDirectory: (input: DockerContainerCreateDirectoryBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.createDirectory(input)),

  openContainerTerminalSession: (input: DockerContainerTerminalOpenBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.openTerminal(input)),

  sendContainerTerminalInput: (input: DockerContainerTerminalInputBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.sendTerminalInput(input)),

  closeContainerTerminalSession: (input: DockerContainerTerminalCloseBodyInput) =>
    Effect.flatMap(DockerContainerAccess, (access) => access.closeTerminal(input)),
});

export type DockerContainersOrchestratorUnaryShape = ReturnType<typeof makeUnary>;

/** The services a caller must be able to see for any unary call to run. */
export type DockerContainersOrchestratorPorts = {
  [K in keyof DockerContainersOrchestratorUnaryShape]: Effect.Services<
    ReturnType<DockerContainersOrchestratorUnaryShape[K]>
  >;
}[keyof DockerContainersOrchestratorUnaryShape];

/** The whole container surface: the unary calls as Effects, the four streams as RxJS. */
export type DockerContainersOrchestratorShape = DockerContainersOrchestratorUnaryShape & DockerContainerStreamsShape;

/**
 * The container surface, as an Effect service.
 *
 * The unary calls are constant Effects that yield their collaborators (`DockerContainerResolution`, `DockerContainerAccess`,
 * `DockerContainerLinks`, `DockerEngine`) when a method runs, so a handler's `R` names them and the requirement gate
 * audits them. The streams stay RxJS — `withStreams` attaches the adapter that owns the `EffectHost` runtime touchpoint.
 */
export class DockerContainersOrchestratorService extends Context.Service<
  DockerContainersOrchestratorService,
  DockerContainersOrchestratorShape
>()("runtime/DockerContainersOrchestratorService") {
  static readonly live: DockerContainersOrchestratorUnaryShape = makeUnary();

  static readonly withStreams = (streams: DockerContainerStreamsShape): DockerContainersOrchestratorShape => ({
    ...makeUnary(),
    ...streams,
  });
}

/**
 * The Nest provider hands a value, not an instance, so the instance type is widened by hand: `DockerController`
 * injects this token and reads the unary methods and the four streams straight off it.
 */
export interface DockerContainersOrchestratorService extends DockerContainersOrchestratorShape {}
