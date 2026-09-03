import { Injectable } from "@nestjs/common";
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
} from "@repo/api-contracts/modules/docker/containers/shared";
import {
  dockerContainerLinkPathSchema,
  type DockerContainerLinkPath,
  type DockerContainerLogEntry,
  type DockerContainerProcessEntry,
} from "@repo/contracts-entities";
import { AppLogger } from "@repo/logger";
import { DockerService as CoreDockerService } from "@/core/modules/docker/services/docker.service";
import { DockerContainerLinksRepository } from "../../../repositories/containers/links/docker-container-links.repository";
import { DockerContainerRuntimeMeshService } from "../mesh/docker-container-runtime-mesh.service";
import { DockerContainerLogsDomainService } from "../runtime/docker-container-logs-domain.service";
import { DockerContainerRuntimeService } from "../runtime/docker-container-runtime.service";
import { DockerContainerShellDomainService } from "../runtime/docker-container-shell-domain.service";
import { DockerContainerResolutionService } from "./docker-container-resolution.service";

import { AppError } from "@repo/errors";
interface DockerTerminalStreamEvent {
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
    private readonly dockerContainerLinksRepository: DockerContainerLinksRepository,
    private readonly dockerContainerRuntimeService: DockerContainerRuntimeService,
    private readonly dockerContainerLogsDomainService: DockerContainerLogsDomainService,
    private readonly dockerContainerShellDomainService: DockerContainerShellDomainService,
    private readonly dockerContainerResolutionService: DockerContainerResolutionService,
    private readonly dockerContainerRuntimeMeshService: DockerContainerRuntimeMeshService,
    private readonly coreDockerService: CoreDockerService,
  ) {}

  listContainers(input: DockerContainerListInput = {} as DockerContainerListInput, options?: { localOnly?: boolean }) {
    this.debug("DockerContainersOrchestratorService.listContainers", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
      localOnly: options?.localOnly ?? false,
    });
    return this.dockerContainerResolutionService.listContainers(input, options);
  }

  listContainersGrouped(input: DockerContainerGroupedListInput, options?: { localOnly?: boolean }) {
    this.debug("DockerContainersOrchestratorService.listContainersGrouped", {
      limit: input.limit,
      offset: input.offset,
      hasFilter: Boolean(input.filter),
      localOnly: options?.localOnly ?? false,
    });
    return this.dockerContainerResolutionService.listContainersGrouped(input, options);
  }

  async listContainersLinked(input: DockerContainerLinkedListQueryInput, platformRole: string | null) {
    this.debug("DockerContainersOrchestratorService.listContainersLinked", {
      limit: input.limit,
      offset: input.offset,
      include: input.include,
      maxDepth: input.maxDepth,
      platformRole,
    });

    const { include, maxDepth, ...listInput } = input;
    const containerList = await this.dockerContainerResolutionService.listContainers(listInput);
    const includePaths = this.parseIncludePaths(include, maxDepth);

    const data = await this.dockerContainerLinksRepository.attachContainerLinks(
      containerList.data,
      includePaths,
      platformRole,
    );

    return {
      data,
      meta: containerList.meta,
    };
  }

  inspectContainer(input: DockerContainerInspectQueryInput) {
    this.debug("DockerContainersOrchestratorService.inspectContainer", {
      containerId: input.containerId,
    });

    return this.dockerContainerResolutionService.inspectContainer(input.containerId);
  }

  async runContainerAction(input: DockerContainerRuntimeActionBodyInput) {
    this.debug("DockerContainersOrchestratorService.runContainerAction", {
      containerId: input.containerId,
      action: input.action,
    });

    switch (input.action) {
      case "start": {
        await this.coreDockerService.startContainer(input.containerId);
        break;
      }
      case "stop": {
        await this.coreDockerService.stopContainer(input.containerId);
        break;
      }
      case "restart": {
        await this.coreDockerService.restartContainer(input.containerId);
        break;
      }
      case "pause": {
        await this.coreDockerService.pauseContainer(input.containerId);
        break;
      }
      case "unpause": {
        await this.coreDockerService.unpauseContainer(input.containerId);
        break;
      }
      case "kill": {
        await this.coreDockerService.killContainer(input.containerId);
        break;
      }
      case "remove": {
        await this.coreDockerService.removeContainer(input.containerId);
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
