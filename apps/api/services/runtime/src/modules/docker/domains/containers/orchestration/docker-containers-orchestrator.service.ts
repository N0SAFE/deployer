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
import { DockerContainerRuntimeMeshService } from "../mesh/docker-container-runtime-mesh.service";
import { DockerContainerLogsDomainService } from "../runtime/docker-container-logs-domain.service";
import { DockerContainerRuntimeService } from "../runtime/docker-container-runtime.service";
import { DockerContainerShellDomainService } from "../runtime/docker-container-shell-domain.service";
import { EffectRuntime } from "@deployer/nest-effect";
import { withContainerResolution } from "./docker-container-resolution";

import { AppError } from "@deployer/errors";
type DockerTerminalStreamEvent = {
  sessionId: string;
  timestamp: Date;
  type: "output" | "status" | "error";
  data: string;
}

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
    private readonly dockerContainerRuntimeService: DockerContainerRuntimeService,
    private readonly dockerContainerLogsDomainService: DockerContainerLogsDomainService,
    private readonly dockerContainerShellDomainService: DockerContainerShellDomainService,
    private readonly effectRuntime: EffectRuntime,
    private readonly dockerContainerRuntimeMeshService: DockerContainerRuntimeMeshService,
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
    return this.dockerContainerLogsDomainService.streamContainerLogs(input);
  }

  async listContainerLogs(input: DockerContainerLogsStreamQueryInput) {
    return this.dockerContainerLogsDomainService.listContainerLogs(input);
  }

  async listContainerProcesses(input: DockerContainerProcessesQueryInput) {
    return this.dockerContainerLogsDomainService.listContainerProcesses(input);
  }

  streamContainerProcesses(input: DockerContainerProcessesStreamQueryInput): Observable<{
    generatedAt: string;
    data: DockerContainerProcessEntry[];
  }> {
    return this.dockerContainerLogsDomainService.streamContainerProcesses(input);
  }

  streamContainerProcessLogs(input: DockerContainerProcessLogsStreamQueryInput) {
    return this.dockerContainerLogsDomainService.streamContainerProcessLogs(input);
  }

  async listContainerFiles(input: DockerContainerFilesQueryInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.listContainerFiles(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.listContainerFilesSnapshotAcrossInstances(
            {
              query: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.snapshot ?? null;
      },
    );
  }

  async readContainerFile(input: DockerContainerReadFileQueryInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.readContainerFile(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.readContainerFileSnapshotAcrossInstances(
            {
              query: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.snapshot ?? null;
      },
    );
  }

  async writeContainerFile(input: DockerContainerWriteFileBodyInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.writeContainerFile(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.writeContainerFileAcrossInstances(
            {
              body: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.ack ?? null;
      },
    );
  }

  async deleteContainerPath(input: DockerContainerDeletePathBodyInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.deleteContainerPath(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.deleteContainerPathAcrossInstances(
            {
              body: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.ack ?? null;
      },
    );
  }

  async renameContainerPath(input: DockerContainerRenamePathBodyInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.renameContainerPath(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.renameContainerPathAcrossInstances(
            {
              body: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.ack ?? null;
      },
    );
  }

  async createContainerDirectory(input: DockerContainerCreateDirectoryBodyInput) {
    return this.withContainerMeshFallback(
      () => this.dockerContainerRuntimeService.createContainerDirectory(input),
      async () => {
        const response = await this.getFirstResponse(
          this.dockerContainerRuntimeMeshService.createContainerDirectoryAcrossInstances(
            {
              body: input,
            },
            {
              timeoutMs: 1_500,
              maxCollectedResponses: 1,
              stopWhen: () => true,
            },
          ),
        );

        return response?.ack ?? null;
      },
    );
  }

  async openContainerTerminalSession(input: DockerContainerTerminalOpenBodyInput) {
    return this.dockerContainerShellDomainService.openContainerTerminalSession(input);
  }

  streamContainerTerminalSession(input: DockerContainerTerminalStreamQueryInput): Observable<DockerTerminalStreamEvent> {
    return this.dockerContainerShellDomainService.streamContainerTerminalSession(input);
  }

  async sendContainerTerminalInput(input: DockerContainerTerminalInputBodyInput) {
    return this.dockerContainerShellDomainService.sendContainerTerminalInput(input);
  }

  async closeContainerTerminalSession(input: DockerContainerTerminalCloseBodyInput) {
    return this.dockerContainerShellDomainService.closeContainerTerminalSession(input);
  }

  private async withContainerMeshFallback<T>(
    localOperation: () => Promise<T>,
    meshOperation: () => Promise<T | null>,
  ): Promise<T> {
    try {
      return await localOperation();
    } catch (error) {
      if (!this.isContainerNotFoundLikeError(error)) {
        throw error;
      }

      const meshValue = await meshOperation();
      if (meshValue !== null) {
        return meshValue;
      }

      throw error;
    }
  }

  private async getFirstResponse<T>(call: Promise<{ responses: readonly T[] }>): Promise<T | null> {
    const result = await call;
    return result.responses[0] ?? null;
  }

  private isContainerNotFoundLikeError(error: unknown): boolean {
    const message = this.formatError(error).toLowerCase();
    return (
      message.includes("no such container")
      || (message.includes("container") && message.includes("not found"))
      || (message.includes("404") && message.includes("container"))
    );
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
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
