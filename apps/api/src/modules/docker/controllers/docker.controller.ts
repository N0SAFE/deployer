import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { standardErrorOptions } from "@repo/orpc-utils";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { MeshInternalRequestService } from "@/core/modules/mesh/services/mesh-internal-request.service";
import { DockerContainersOrchestratorService } from "../domains/containers/orchestration/docker-containers-orchestrator.service";
import { DockerImagesOrchestratorService } from "../domains/images/orchestration/docker-images-orchestrator.service";
import { DockerRuntimeOrchestratorService } from "../domains/runtime/orchestration/docker-runtime-orchestrator.service";
import { DockerNetworksOrchestratorService } from "../domains/networks/orchestration/docker-networks-orchestrator.service";
import { DockerVolumesOrchestratorService } from "../domains/volumes/orchestration/docker-volumes-orchestrator.service";
import { DockerRegistriesOrchestratorService } from "../domains/registries/orchestration/docker-registries-orchestrator.service";
import { DockerStacksOrchestratorService } from "../domains/stacks/orchestration/docker-stacks-orchestrator.service";
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
    private readonly dockerRegistriesOrchestratorService: DockerRegistriesOrchestratorService,
    private readonly dockerStacksOrchestratorService: DockerStacksOrchestratorService,
    private readonly dockerEntityOrchestratorService: DockerEntityOrchestratorService,
    private readonly meshInternalRequestService: MeshInternalRequestService,
  ) {}

  @Implement(appContract.docker.containers.list)
  listContainers() {
    return implement(appContract.docker.containers.list)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainers(input.query, {
          localOnly: this.isMeshLocalOnlyRequest(context),
        }));
  }

  @Implement(appContract.docker.containers.grouped)
  listContainersGrouped() {
    return implement(appContract.docker.containers.grouped)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainersGrouped(input.query, {
          localOnly: this.isMeshLocalOnlyRequest(context),
        }));
  }

  @Implement(appContract.docker.containers.linked)
  listContainersLinked() {
    return implement(appContract.docker.containers.linked)
      .use(requireAuth())
      .handler(async ({ input, context }) =>
        this.dockerContainersOrchestratorService.listContainersLinked(input.query, context.auth.user.role ?? null),
      );
  }

  @Implement(appContract.docker.containers.inspect)
  inspectContainer() {
    return implement(appContract.docker.containers.inspect)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerContainersOrchestratorService.inspectContainer(input.query));
  }

  @Implement(appContract.docker.containers.actions.run)
  runContainerAction() {
    return implement(appContract.docker.containers.actions.run)
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

  @Implement(appContract.docker.images.inspect)
  inspectImage() {
    return implement(appContract.docker.images.inspect)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerImagesOrchestratorService.inspectImage(input.query));
  }

  @Implement(appContract.docker.containers.streams.inspect)
  streamInspectContainer() {
    return implement(appContract.docker.containers.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamContainerInspect(input.query));
  }

  @Implement(appContract.docker.containers.streams.logs)
  streamContainerLogs() {
    return implement(appContract.docker.containers.streams.logs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerLogs(input.query));
  }

  @Implement(appContract.docker.containers.logs.list)
  listContainerLogs() {
    return implement(appContract.docker.containers.logs.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const snapshot = await this.dockerContainersOrchestratorService.listContainerLogs(input.query);
        return {
          ...snapshot,
          generatedAt: this.toDate(snapshot.generatedAt),
        };
      });
  }

  @Implement(appContract.docker.containers.processes.list)
  listContainerProcesses() {
    return implement(appContract.docker.containers.processes.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const snapshot = await this.dockerContainersOrchestratorService.listContainerProcesses(input.query);
        return {
          ...snapshot,
          generatedAt: this.toDate(snapshot.generatedAt),
        };
      });
  }

  @Implement(appContract.docker.containers.streams.processes)
  streamContainerProcesses() {
    return implement(appContract.docker.containers.streams.processes)
      .use(requireAuth())
      .handler(({ input }) =>
        this.dockerContainersOrchestratorService.streamContainerProcesses(input.query).pipe(
          map((snapshot) => ({
            ...snapshot,
            generatedAt: this.toDate(snapshot.generatedAt),
          })),
        ));
  }

  @Implement(appContract.docker.containers.streams.processLogs)
  streamContainerProcessLogs() {
    return implement(appContract.docker.containers.streams.processLogs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerProcessLogs(input.query));
  }

  @Implement(appContract.docker.containers.filesystem.list)
  listContainerFiles() {
    return implement(appContract.docker.containers.filesystem.list)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const listing = await this.dockerContainersOrchestratorService.listContainerFiles(input.query);
        return {
          ...listing,
          generatedAt: this.toDate(listing.generatedAt),
        };
      });
  }

  @Implement(appContract.docker.containers.filesystem.read)
  readContainerFile() {
    return implement(appContract.docker.containers.filesystem.read)
      .use(requireAuth())
      .handler(async ({ input }) => {
        const file = await this.dockerContainersOrchestratorService.readContainerFile(input.query);
        return {
          ...file,
          generatedAt: this.toDate(file.generatedAt),
        };
      });
  }

  @Implement(appContract.docker.containers.filesystem.write)
  writeContainerFile() {
    return implement(appContract.docker.containers.filesystem.write)
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

  @Implement(appContract.docker.containers.filesystem.deletePath)
  deleteContainerPath() {
    return implement(appContract.docker.containers.filesystem.deletePath)
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

  @Implement(appContract.docker.containers.filesystem.renamePath)
  renameContainerPath() {
    return implement(appContract.docker.containers.filesystem.renamePath)
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

  @Implement(appContract.docker.containers.filesystem.createDirectory)
  createContainerDirectory() {
    return implement(appContract.docker.containers.filesystem.createDirectory)
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

  @Implement(appContract.docker.containers.terminal.open)
  openContainerTerminalSession() {
    return implement(appContract.docker.containers.terminal.open)
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

  @Implement(appContract.docker.containers.terminal.stream)
  streamContainerTerminalSession() {
    return implement(appContract.docker.containers.terminal.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerTerminalSession(input.query));
  }

  @Implement(appContract.docker.containers.terminal.sendInput)
  sendContainerTerminalInput() {
    return implement(appContract.docker.containers.terminal.sendInput)
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

  @Implement(appContract.docker.containers.terminal.close)
  closeContainerTerminalSession() {
    return implement(appContract.docker.containers.terminal.close)
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

  @Implement(appContract.docker.images.streams.inspect)
  streamInspectImage() {
    return implement(appContract.docker.images.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageInspect(input.query));
  }

  @Implement(appContract.docker.images.security.scanning.stream)
  streamImageSecurityScan() {
    return implement(appContract.docker.images.security.scanning.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageSecurityScan(input.query));
  }

  @Implement(appContract.docker.images.list)
  listImages() {
    return implement(appContract.docker.images.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerImagesOrchestratorService.listImages(input.query));
  }

  @Implement(appContract.docker.networks.list)
  listNetworks() {
    return implement(appContract.docker.networks.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerNetworksOrchestratorService.listNetworks(input.query));
  }

  @Implement(appContract.docker.volumes.list)
  listVolumes() {
    return implement(appContract.docker.volumes.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerVolumesOrchestratorService.listVolumes(input.query));
  }

  @Implement(appContract.docker.registries.list)
  listRegistries() {
    return implement(appContract.docker.registries.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerRegistriesOrchestratorService.listRegistries(input.query));
  }

  @Implement(appContract.docker.stacks.list)
  listStacks() {
    return implement(appContract.docker.stacks.list)
      .use(requireAuth())
      .handler(async ({ input }) => this.dockerStacksOrchestratorService.listStacks(input.query));
  }

  @Implement(appContract.docker.runtime.snapshot)
  runtimeSnapshot() {
    return implement(appContract.docker.runtime.snapshot)
      .use(requireAuth())
      .handler(() => this.dockerRuntimeOrchestratorService.getRuntimeSnapshot());
  }

  @Implement(appContract.docker.runtime.stream)
  stream() {
    return implement(appContract.docker.runtime.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.stream(input.query ?? {}));
  }

  @Implement(appContract.docker.runtime.activity.list)
  runtimeActivityList() {
    return implement(appContract.docker.runtime.activity.list)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.listRuntimeActivities(input.query));
  }

  @Implement(appContract.docker.runtime.activity.detail)
  runtimeActivityDetail() {
    return implement(appContract.docker.runtime.activity.detail)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.getRuntimeActivityById(input.query));
  }

  @Implement(appContract.docker.runtime.activityStream)
  runtimeActivityStream() {
    return implement(appContract.docker.runtime.activityStream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamRuntimeActivities(input.query ?? {}));
  }

  // ---------------------------------------------------------------------------
  // docker.entity — unified live in-memory store for all entity kinds
  // ---------------------------------------------------------------------------

  @Implement(appContract.docker.entity.list)
  entityList() {
    return implement(appContract.docker.entity.list)
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

  @Implement(appContract.docker.entity.inspect)
  entityInspect() {
    return implement(appContract.docker.entity.inspect)
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

  @Implement(appContract.docker.entity.stream)
  entityStream() {
    return implement(appContract.docker.entity.stream)
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
