import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { dockerContract } from "@repo/api-contracts";
import { standardErrorOptions } from "@repo/orpc-utils";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { MeshInternalRequestService } from "@/core/modules/mesh/services/mesh-internal-request.service";
import { DockerContainersOrchestratorService } from "../domains/containers/orchestration/docker-containers-orchestrator.service";
import { DockerImagesOrchestratorService } from "../domains/images/orchestration/docker-images-orchestrator.service";
import { DockerRuntimeOrchestratorService } from "../domains/runtime/orchestration/docker-runtime-orchestrator.service";
import { DockerNetworksOrchestratorService } from "../domains/networks/orchestration/docker-networks-orchestrator.service";
import { DockerVolumesOrchestratorService } from "../domains/volumes/orchestration/docker-volumes-orchestrator.service";
import { DockerEntityOrchestratorService } from "../domains/entity/orchestration/docker-entity-orchestrator.service";
import { map } from "rxjs";

@Controller()
export class DockerController {
  constructor(
    private readonly dockerContainersOrchestratorService: DockerContainersOrchestratorService,
    private readonly dockerImagesOrchestratorService: DockerImagesOrchestratorService,
    private readonly dockerRuntimeOrchestratorService: DockerRuntimeOrchestratorService,
    private readonly dockerNetworksOrchestratorService: DockerNetworksOrchestratorService,
    private readonly dockerVolumesOrchestratorService: DockerVolumesOrchestratorService,
    private readonly dockerEntityOrchestratorService: DockerEntityOrchestratorService,
    private readonly meshInternalRequestService: MeshInternalRequestService,
  ) {}

  @Implement(dockerContract.containers.list)
  listContainers() {
    return implement(dockerContract.containers.list)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainers(input.query, {
          localOnly: this.isMeshLocalOnlyRequest(context),
        }));
  }

  @Implement(dockerContract.containers.grouped)
  listContainersGrouped() {
    return implement(dockerContract.containers.grouped)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainersGrouped(input.query, {
          localOnly: this.isMeshLocalOnlyRequest(context),
        }));
  }

  @Implement(dockerContract.containers.linked)
  listContainersLinked() {
    return implement(dockerContract.containers.linked)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainersLinked(input.query, context.auth.user.role ?? null),
      );
  }

  @Implement(dockerContract.containers.inspect)
  inspectContainer() {
    return implement(dockerContract.containers.inspect)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerContainersOrchestratorService.inspectContainer(input.query));
  }

  @Implement(dockerContract.containers.actions.run)
  runContainerAction() {
    return implement(dockerContract.containers.actions.run)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.runContainerAction(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.images.inspect)
  inspectImage() {
    return implement(dockerContract.images.inspect)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerImagesOrchestratorService.inspectImage(input.query));
  }

  @Implement(dockerContract.containers.streams.inspect)
  streamInspectContainer() {
    return implement(dockerContract.containers.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamContainerInspect(input.query));
  }

  @Implement(dockerContract.containers.streams.logs)
  streamContainerLogs() {
    return implement(dockerContract.containers.streams.logs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerLogs(input.query));
  }

  @Implement(dockerContract.containers.logs.list)
  listContainerLogs() {
    return implement(dockerContract.containers.logs.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const snapshot = await this.dockerContainersOrchestratorService.listContainerLogs(input.query);
        return {
          ...snapshot,
          generatedAt: this.toDate(snapshot.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.processes.list)
  listContainerProcesses() {
    return implement(dockerContract.containers.processes.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const snapshot = await this.dockerContainersOrchestratorService.listContainerProcesses(input.query);
        return {
          ...snapshot,
          generatedAt: this.toDate(snapshot.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.streams.processes)
  streamContainerProcesses() {
    return implement(dockerContract.containers.streams.processes)
      .use(requireAuth())
      .handler(({ input }) =>
        this.dockerContainersOrchestratorService.streamContainerProcesses(input.query).pipe(
          map((snapshot) => ({
            ...snapshot,
            generatedAt: this.toDate(snapshot.generatedAt),
          })),
        ));
  }

  @Implement(dockerContract.containers.streams.processLogs)
  streamContainerProcessLogs() {
    return implement(dockerContract.containers.streams.processLogs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerProcessLogs(input.query));
  }

  @Implement(dockerContract.containers.filesystem.list)
  listContainerFiles() {
    return implement(dockerContract.containers.filesystem.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const listing = await this.dockerContainersOrchestratorService.listContainerFiles(input.query);
        return {
          ...listing,
          generatedAt: this.toDate(listing.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.read)
  readContainerFile() {
    return implement(dockerContract.containers.filesystem.read)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const file = await this.dockerContainersOrchestratorService.readContainerFile(input.query);
        return {
          ...file,
          generatedAt: this.toDate(file.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.write)
  writeContainerFile() {
    return implement(dockerContract.containers.filesystem.write)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.writeContainerFile(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.deletePath)
  deleteContainerPath() {
    return implement(dockerContract.containers.filesystem.deletePath)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.deleteContainerPath(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.renamePath)
  renameContainerPath() {
    return implement(dockerContract.containers.filesystem.renamePath)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.renameContainerPath(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.createDirectory)
  createContainerDirectory() {
    return implement(dockerContract.containers.filesystem.createDirectory)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.createContainerDirectory(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.open)
  openContainerTerminalSession() {
    return implement(dockerContract.containers.terminal.open)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const session = await this.dockerContainersOrchestratorService.openContainerTerminalSession(input);
        return {
          status: 201,
          body: {
            ...session,
            openedAt: this.toDate(session.openedAt),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.stream)
  streamContainerTerminalSession() {
    return implement(dockerContract.containers.terminal.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerTerminalSession(input.query));
  }

  @Implement(dockerContract.containers.terminal.sendInput)
  sendContainerTerminalInput() {
    return implement(dockerContract.containers.terminal.sendInput)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.sendContainerTerminalInput(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.close)
  closeContainerTerminalSession() {
    return implement(dockerContract.containers.terminal.close)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const ack = await this.dockerContainersOrchestratorService.closeContainerTerminalSession(input);
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: this.toDate(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.images.streams.inspect)
  streamInspectImage() {
    return implement(dockerContract.images.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageInspect(input.query));
  }

  @Implement(dockerContract.images.security.scanning.stream)
  streamImageSecurityScan() {
    return implement(dockerContract.images.security.scanning.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageSecurityScan(input.query));
  }

  @Implement(dockerContract.images.list)
  listImages() {
    return implement(dockerContract.images.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerImagesOrchestratorService.listImages(input.query));
  }

  @Implement(dockerContract.networks.list)
  listNetworks() {
    return implement(dockerContract.networks.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerNetworksOrchestratorService.listNetworks(input.query));
  }

  @Implement(dockerContract.volumes.list)
  listVolumes() {
    return implement(dockerContract.volumes.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerVolumesOrchestratorService.listVolumes(input.query));
  }

  @Implement(dockerContract.runtime.snapshot)
  runtimeSnapshot() {
    return implement(dockerContract.runtime.snapshot)
      .use(requireAuth())
      .handler(() => this.dockerRuntimeOrchestratorService.getRuntimeSnapshot());
  }

  @Implement(dockerContract.runtime.stream)
  stream() {
    return implement(dockerContract.runtime.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.stream(input.query ?? {}));
  }

  @Implement(dockerContract.runtime.activity.list)
  runtimeActivityList() {
    return implement(dockerContract.runtime.activity.list)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.listRuntimeActivities(input.query));
  }

  @Implement(dockerContract.runtime.activity.detail)
  runtimeActivityDetail() {
    return implement(dockerContract.runtime.activity.detail)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.getRuntimeActivityById(input.query));
  }

  @Implement(dockerContract.runtime.activityStream)
  runtimeActivityStream() {
    return implement(dockerContract.runtime.activityStream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamRuntimeActivities(input.query ?? {}));
  }

  // ---------------------------------------------------------------------------
  // docker.entity — unified live in-memory store for all entity kinds
  // ---------------------------------------------------------------------------

  @Implement(dockerContract.entity.list)
  entityList() {
    return implement(dockerContract.entity.list)
      .use(requireAuth())
      .handler(async ({ input, errors }) => {
        switch (input.kind) {
          case "container":
            return this.dockerEntityOrchestratorService.listContainers(input)
          case "image":
            return this.dockerEntityOrchestratorService.listImages(input)
          case "network":
            return this.dockerEntityOrchestratorService.listNetworks(input)
          case "volume":
            return this.dockerEntityOrchestratorService.listVolumes(input)
          default:
            throw errors.BAD_REQUEST(
              standardErrorOptions("validation", `Unsupported entity kind: ${String(input.kind)}`),
            )
        }
      })
  }

  @Implement(dockerContract.entity.inspect)
  entityInspect() {
    return implement(dockerContract.entity.inspect)
      .use(requireAuth())
      .handler(async ({ input, errors }) => {
        switch (input.kind) {
          case "container":
            return this.dockerEntityOrchestratorService.inspectContainer(input)
          case "image":
            return this.dockerEntityOrchestratorService.inspectImage(input)
          case "network":
            return this.dockerEntityOrchestratorService.inspectNetwork(input)
          case "volume":
            return this.dockerEntityOrchestratorService.inspectVolume(input)
          default:
            throw errors.BAD_REQUEST(
              standardErrorOptions("validation", `Unsupported entity kind: ${String(input.kind)}`),
            )
        }
      })
  }

  @Implement(dockerContract.entity.stream)
  entityStream() {
    return implement(dockerContract.entity.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerEntityOrchestratorService.streamEntities(input.query ?? {}));
  }

  private isMeshLocalOnlyRequest(context: unknown): boolean {
    if (!context || typeof context !== "object") {
      return false;
    }

    const contextWithRequest = context as { request?: unknown };
    if (!contextWithRequest.request) {
      return false;
    }

    return this.meshInternalRequestService.isLocalOnlyMeshRequest(contextWithRequest.request);
  }

  private toDate(value: string | Date): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
