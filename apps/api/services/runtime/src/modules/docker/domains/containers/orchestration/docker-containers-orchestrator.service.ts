import { Injectable, Inject } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Observable } from "rxjs";
import type {
  DockerContainerCreateDirectoryBodyInput,
  DockerContainerDeletePathBodyInput,
  DockerContainerFilesQueryInput,
  DockerContainerGroupedListInput,
  DockerContainerInspectQueryInput,
  DockerContainerLinkedListQueryInput,
  DockerContainerListInput,
  DockerContainerLogsStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerProcessesQueryInput,
  DockerContainerProcessesStreamQueryInput,
  DockerContainerReadFileQueryInput,
  DockerContainerRenamePathBodyInput,
  DockerContainerRuntimeActionBodyInput,
  DockerContainerTerminalCloseBodyInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
  DockerContainerWriteFileBodyInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import {
  dockerContainerLinkPathSchema,
  type DockerContainerLinkPath,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
} from "@deployer/contracts-entities";
import { AppLogger } from "@deployer/logger";
import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { Effect } from "effect";
import { DockerContainerLinks } from "../../../repositories/containers/links/docker-container-links";
import { EffectRuntime } from "@deployer/nest-effect";
import { accessStream, withContainerAccess, type TerminalStreamEvent } from "../runtime/docker-container-access";
import { withContainerResolution } from "./docker-container-resolution";

import { AppError } from "@deployer/errors";
type DockerTerminalStreamEvent = {
  sessionId: string;
  timestamp: Date;
  type: "output" | "status" | "error";
  data: string;
}

/** The label the supervisors stamp on the containers they own. */
const PLATFORM_ROLE_LABEL = "deployer.platform.role";
/** What a caller may not do to a platform container. */
const PROTECTED_ACTIONS: ReadonlySet<string> = new Set(["stop", "restart", "pause", "kill", "remove"]);

@Injectable()
export class DockerContainersOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerContainersOrchestratorService.name);
  private readonly scopedLogger = this.apiLogger.log;

  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerContainersOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-containers-orchestrator",
  });

  constructor(
    private readonly effectRuntime: EffectRuntime,
    @Inject(DockerEngine) private readonly dockerEngine: DockerEngineShape,
  ) {}

  async listContainersLinked(input: DockerContainerLinkedListQueryInput, platformRole: string | null) {
    this.debug("DockerContainersOrchestratorService.listContainersLinked", {
      limit: input.limit,
      offset: input.offset,
      include: input.include,
      maxDepth: input.maxDepth,
      platformRole,
    });

    const { include, maxDepth, ...listInput } = input;
    const containerList = await withContainerResolution(this.effectRuntime, (resolution) => resolution.listContainers(listInput));
    const includePaths = this.parseIncludePaths(include, maxDepth);

    const data = await this.effectRuntime.runPromiseUnwrapped(
      Effect.gen(function* () {
        const links = yield* DockerContainerLinks;
        return yield* links.attach(containerList.data, includePaths, platformRole);
      }),
    );

    return {
      data,
      meta: containerList.meta,
    };
  }

  async runContainerAction(input: DockerContainerRuntimeActionBodyInput) {
    this.debug("DockerContainersOrchestratorService.runContainerAction", {
      containerId: input.containerId,
      action: input.action,
    });

    // CLUSTER-004: a platform-managed container is owned by a supervisor. Stopping, killing or removing it from the
    // dashboard takes the ingress, database or agent down without the platform noticing, so those actions are refused.
    // Starting and unpausing stay allowed: they are recovery, not destruction.
    if (PROTECTED_ACTIONS.has(input.action)) {
      const info = await runPromiseUnwrapped(
        this.dockerEngine.containers.inspect(input.containerId).pipe(Effect.catch(() => Effect.succeed(null))),
      );
      const managedBy = info?.Config?.Labels?.[PLATFORM_ROLE_LABEL];
      if (managedBy !== undefined && managedBy !== "") {
        throw new AppError(
          `Container ${input.containerId} is managed by the platform (${managedBy}): ${input.action} is refused. ` +
            "Use the platform's own controls; a copy started by hand is not supervised.",
          "FORBIDDEN",
        );
      }
    }

    switch (input.action) {
      case "start": {
        await runPromiseUnwrapped(this.dockerEngine.containers.start(input.containerId));
        break;
      }
      case "stop": {
        await runPromiseUnwrapped(this.dockerEngine.containers.stop(input.containerId));
        break;
      }
      case "restart": {
        await runPromiseUnwrapped(this.dockerEngine.containers.restart(input.containerId));
        break;
      }
      case "pause": {
        await runPromiseUnwrapped(this.dockerEngine.containers.pause(input.containerId));
        break;
      }
      case "unpause": {
        await runPromiseUnwrapped(this.dockerEngine.containers.unpause(input.containerId));
        break;
      }
      case "kill": {
        await runPromiseUnwrapped(this.dockerEngine.containers.kill(input.containerId));
        break;
      }
      case "remove": {
        await runPromiseUnwrapped(this.dockerEngine.containers.remove(input.containerId));
        break;
      }
      default: {
        const exhaustiveCheck: never = input.action;
        throw new AppError(`Unsupported container action: ${String(exhaustiveCheck)}`, `INTERNAL_ERROR`);
      }
    }

    return {
      ok: true as const,
      containerId: input.containerId,
      action: input.action,
      timestamp: new Date(),
    };
  }

  streamContainerLogs(input: DockerContainerLogsStreamQueryInput): Observable<DockerContainerLogEntry> {
    return accessStream(this.effectRuntime, (access) => access.streamLogs(input));
  }

  listContainerLogs(input: DockerContainerLogsStreamQueryInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.listLogs(input));
  }

  listContainerProcesses(input: DockerContainerProcessesQueryInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.listProcesses(input));
  }

  streamContainerProcesses(input: DockerContainerProcessesStreamQueryInput): Observable<{ generatedAt: string; data: DockerContainerProcessEntry[] }> {
    return accessStream(this.effectRuntime, (access) => access.streamProcesses(input));
  }

  streamContainerProcessLogs(input: DockerContainerProcessLogsStreamQueryInput) {
    return accessStream(this.effectRuntime, (access) => access.streamProcessLogs(input));
  }

  listContainerFiles(input: DockerContainerFilesQueryInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.listFiles(input));
  }

  readContainerFile(input: DockerContainerReadFileQueryInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.readFile(input));
  }

  writeContainerFile(input: DockerContainerWriteFileBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.writeFile(input));
  }

  deleteContainerPath(input: DockerContainerDeletePathBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.deletePath(input));
  }

  renameContainerPath(input: DockerContainerRenamePathBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.renamePath(input));
  }

  createContainerDirectory(input: DockerContainerCreateDirectoryBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.createDirectory(input));
  }

  openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.openTerminal(input));
  }

  streamContainerTerminalSession(input: DockerContainerTerminalStreamQueryInput): Observable<TerminalStreamEvent> {
    return accessStream(this.effectRuntime, (access) => access.streamTerminal(input));
  }

  sendContainerTerminalInput(input: DockerContainerTerminalInputBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.sendTerminalInput(input));
  }

  closeContainerTerminalSession(input: DockerContainerTerminalCloseBodyInput) {
    return withContainerAccess(this.effectRuntime, (access) => access.closeTerminal(input));
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-containers-orchestrator] ${source}`, context ?? {});
    this.debugLogger.debug(source, context);
  }

  private parseIncludePaths(include: string | undefined, maxDepth: number): DockerContainerLinkPath[] {
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

      if (this.computePathDepth(parsedPath.data) <= normalizedDepth) {
        uniquePaths.add(parsedPath.data);
      }
    }

    return [...uniquePaths];
  }

  private computePathDepth(path: DockerContainerLinkPath): number {
    return path.split(".").length;
  }
}
