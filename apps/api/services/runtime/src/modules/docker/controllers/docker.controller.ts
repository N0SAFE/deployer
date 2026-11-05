import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { Effect } from "effect";
import { map } from "rxjs";

import { procedure } from "@deployer/nest-effect";
import { standardErrorOptions } from "@deployer/orpc-utils";
import { dockerContract } from "@deployer/runtime-contracts";
import { ApprovalGuard } from "@deployer/shared/core/modules/approval/approval.guard";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { DockerCatalog } from "../catalog/docker-catalog";
import { DockerContainerResolution, type DockerContainerResolutionPorts } from "../domains/containers/orchestration/docker-container-resolution";
import { DockerContainersOrchestratorService } from "../domains/containers/orchestration/docker-containers-orchestrator.service";
import { DockerContainers, type DockerContainersPorts } from "../domains/containers/orchestration/docker-containers.service";
import { DockerEntityOrchestratorService } from "../domains/entity/orchestration/docker-entity-orchestrator.service";
import { DockerEntity, type DockerEntityPorts } from "../domains/entity/orchestration/docker-entity.service";
import { DockerImagesOrchestratorService } from "../domains/images/orchestration/docker-images-orchestrator.service";
import { DockerImages, type DockerImagesPorts } from "../domains/images/orchestration/docker-images.service";
import {
  DockerRuntimeActivity,
  type DockerRuntimeActivityPorts,
} from "../domains/runtime/orchestration/docker-runtime-activity.service";
import { DockerRuntimeOrchestratorService } from "../domains/runtime/orchestration/docker-runtime-orchestrator.service";

import type { DockerCatalogPorts } from "../catalog/docker-catalog";

/** The contracts carry dates as strings; the handlers answer with `Date`, as oRPC expects. */
const timestampOf = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

/** Container mutation is an operational act: a viewer keeps the reads, never the controls. */
const DOCKER_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

@Controller()
export class DockerController {
  constructor(
    private readonly dockerContainersOrchestratorService: DockerContainersOrchestratorService,
    private readonly dockerImagesOrchestratorService: DockerImagesOrchestratorService,
    private readonly dockerRuntimeOrchestratorService: DockerRuntimeOrchestratorService,
    private readonly dockerEntityOrchestratorService: DockerEntityOrchestratorService,
  ) {}

  @Implement(dockerContract.containers.list)
  listContainers() {
    return procedure(dockerContract.containers.list)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const resolution = yield* DockerContainerResolution;
        const ports = yield* Effect.context<DockerContainerResolutionPorts>();
        return yield* resolution
            .listContainers(input.query)
            .pipe(Effect.provideContext(ports))
        ;
      });
  }

  @Implement(dockerContract.containers.grouped)
  listContainersGrouped() {
    return procedure(dockerContract.containers.grouped)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const resolution = yield* DockerContainerResolution;
        const ports = yield* Effect.context<DockerContainerResolutionPorts>();
        return yield* resolution
            .listContainersGrouped(input.query)
            .pipe(Effect.provideContext(ports))
        ;
      });
  }

  @Implement(dockerContract.containers.linked)
  listContainersLinked() {
    return procedure(dockerContract.containers.linked)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        return yield* containers.listLinked(input.query, context.auth.user.role ?? null).pipe(Effect.provideContext(ports))
        ;
      });
  }

  @Implement(dockerContract.containers.inspect)
  inspectContainer() {
    return procedure(dockerContract.containers.inspect)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const resolution = yield* DockerContainerResolution;
        const ports = yield* Effect.context<DockerContainerResolutionPorts>();
        return yield* resolution.inspectContainer(input.query.containerId).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.containers.actions.run)
  runContainerAction() {
    return procedure(dockerContract.containers.actions.run)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
      .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.runAction(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.images.inspect)
  inspectImage() {
    return procedure(dockerContract.images.inspect)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const images = yield* DockerImages;
        const ports = yield* Effect.context<DockerImagesPorts>();
        return yield* images.inspect(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.containers.streams.inspect)
  streamInspectContainer() {
    return procedure(dockerContract.containers.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamContainerInspect(input.query));
  }

  @Implement(dockerContract.containers.streams.logs)
  streamContainerLogs() {
    return procedure(dockerContract.containers.streams.logs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerLogs(input.query));
  }

  @Implement(dockerContract.containers.logs.list)
  listContainerLogs() {
    return procedure(dockerContract.containers.logs.list)
      .use(requireAuth())
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const snapshot = yield* containers.listLogs(input.query).pipe(Effect.provideContext(ports));
        return {
          ...snapshot,
          generatedAt: timestampOf(snapshot.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.processes.list)
  listContainerProcesses() {
    return procedure(dockerContract.containers.processes.list)
      .use(requireAuth())
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const snapshot = yield* containers.listProcesses(input.query).pipe(Effect.provideContext(ports));
        return {
          ...snapshot,
          generatedAt: timestampOf(snapshot.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.streams.processes)
  streamContainerProcesses() {
    return procedure(dockerContract.containers.streams.processes)
      .use(requireAuth())
      .handler(({ input }) =>
        this.dockerContainersOrchestratorService.streamContainerProcesses(input.query).pipe(
          map((snapshot) => ({
            ...snapshot,
            generatedAt: timestampOf(snapshot.generatedAt),
          })),
        ));
  }

  @Implement(dockerContract.containers.streams.processLogs)
  streamContainerProcessLogs() {
    return procedure(dockerContract.containers.streams.processLogs)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerProcessLogs(input.query));
  }

  @Implement(dockerContract.containers.filesystem.list)
  listContainerFiles() {
    return procedure(dockerContract.containers.filesystem.list)
      .use(requireAuth())
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const listing = yield* containers.listFiles(input.query).pipe(Effect.provideContext(ports));
        return {
          ...listing,
          generatedAt: timestampOf(listing.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.read)
  readContainerFile() {
    return procedure(dockerContract.containers.filesystem.read)
      .use(requireAuth())
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const file = yield* containers.readFile(input.query).pipe(Effect.provideContext(ports));
        return {
          ...file,
          generatedAt: timestampOf(file.generatedAt),
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.write)
  writeContainerFile() {
    return procedure(dockerContract.containers.filesystem.write)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.writeFile(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.deletePath)
  deleteContainerPath() {
    return procedure(dockerContract.containers.filesystem.deletePath)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.deletePath(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.renamePath)
  renameContainerPath() {
    return procedure(dockerContract.containers.filesystem.renamePath)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.renamePath(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.filesystem.createDirectory)
  createContainerDirectory() {
    return procedure(dockerContract.containers.filesystem.createDirectory)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.createDirectory(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.open)
  openContainerTerminalSession() {
    return procedure(dockerContract.containers.terminal.open)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        // A shell in a container is a shell next to production data: whoever lacks `container:exec` needs an approval
        // for THIS container, consumed before the session opens.
        const approvals = yield* ApprovalGuard;
        yield* approvals.require(context.auth.user.id, "container:exec", "container.exec", [input.containerId]);

        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const session = yield* containers.openTerminal(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...session,
            openedAt: timestampOf(session.openedAt),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.stream)
  streamContainerTerminalSession() {
    return procedure(dockerContract.containers.terminal.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerContainersOrchestratorService.streamContainerTerminalSession(input.query));
  }

  @Implement(dockerContract.containers.terminal.sendInput)
  sendContainerTerminalInput() {
    return procedure(dockerContract.containers.terminal.sendInput)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.sendTerminalInput(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.containers.terminal.close)
  closeContainerTerminalSession() {
    return procedure(dockerContract.containers.terminal.close)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
        .effect(function* ({ input, context }) {
        const containers = yield* DockerContainers;
        const ports = yield* Effect.context<DockerContainersPorts>();
        const ack = yield* containers.closeTerminal(input).pipe(Effect.provideContext(ports));
        return {
          status: 201,
          body: {
            ...ack,
            timestamp: timestampOf(ack.timestamp),
          },
        };
      });
  }

  @Implement(dockerContract.images.streams.inspect)
  streamInspectImage() {
    return procedure(dockerContract.images.streams.inspect)
      .use(requireAuth())
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageInspect(input.query));
  }

  @Implement(dockerContract.images.security.scanning.stream)
  streamImageSecurityScan() {
    return procedure(dockerContract.images.security.scanning.stream)
      .use(requireAuth())
      .use(requirePlatformRole(DOCKER_OPERATOR_ROLES))
      .handler(({ input }) => this.dockerImagesOrchestratorService.streamImageSecurityScan(input.query));
  }

  @Implement(dockerContract.images.list)
  listImages() {
    return procedure(dockerContract.images.list)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const images = yield* DockerImages;
        const ports = yield* Effect.context<DockerImagesPorts>();
        return yield* images.list(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.networks.list)
  listNetworks() {
    return procedure(dockerContract.networks.list)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const catalog = yield* DockerCatalog;
        const ports = yield* Effect.context<DockerCatalogPorts>();
        return yield* catalog.listNetworks(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.volumes.list)
  listVolumes() {
    return procedure(dockerContract.volumes.list)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const catalog = yield* DockerCatalog;
        const ports = yield* Effect.context<DockerCatalogPorts>();
        return yield* catalog.listVolumes(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.runtime.snapshot)
  runtimeSnapshot() {
    return procedure(dockerContract.runtime.snapshot)
      .use(requireAuth())
      .effect(function* ({ context }) {
        const activity = yield* DockerRuntimeActivity;
        const ports = yield* Effect.context<DockerRuntimeActivityPorts>();
        return yield* activity.snapshot().pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.runtime.stream)
  stream() {
    return procedure(dockerContract.runtime.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.stream(input.query ?? {}));
  }

  @Implement(dockerContract.runtime.activity.list)
  runtimeActivityList() {
    return procedure(dockerContract.runtime.activity.list)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const activity = yield* DockerRuntimeActivity;
        const ports = yield* Effect.context<DockerRuntimeActivityPorts>();
        return yield* activity.list(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.runtime.activity.detail)
  runtimeActivityDetail() {
    return procedure(dockerContract.runtime.activity.detail)
      .use(requireAuth())
      .effect(function* ({ input, context }) {
        const activity = yield* DockerRuntimeActivity;
        const ports = yield* Effect.context<DockerRuntimeActivityPorts>();
        return yield* activity.getById(input.query).pipe(Effect.provideContext(ports));
      });
  }

  @Implement(dockerContract.runtime.activityStream)
  runtimeActivityStream() {
    return procedure(dockerContract.runtime.activityStream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerRuntimeOrchestratorService.streamRuntimeActivities(input.query ?? {}));
  }

  // ---------------------------------------------------------------------------
  // docker.entity — unified live in-memory store for all entity kinds
  // ---------------------------------------------------------------------------

  @Implement(dockerContract.entity.list)
  entityList() {
    return procedure(dockerContract.entity.list)
      .use(requireAuth())
      .effect(function* ({ input, errors, context }) {
        const entities = yield* DockerEntity;
        const ports = yield* Effect.context<DockerEntityPorts>();
        switch (input.kind) {
          case "container":
            return yield* entities.listContainers(input).pipe(Effect.provideContext(ports));
          case "image":
            return yield* entities.listImages(input).pipe(Effect.provideContext(ports));
          case "network":
            return yield* entities.listNetworks(input).pipe(Effect.provideContext(ports));
          case "volume":
            return yield* entities.listVolumes(input).pipe(Effect.provideContext(ports));
          default:
            return yield* Effect.fail(
              errors.BAD_REQUEST(standardErrorOptions("validation", `Unsupported entity kind: ${String(input.kind)}`)),
            );
        }
      });
  }

  @Implement(dockerContract.entity.inspect)
  entityInspect() {
    return procedure(dockerContract.entity.inspect)
      .use(requireAuth())
      .effect(function* ({ input, errors, context }) {
        const entities = yield* DockerEntity;
        const ports = yield* Effect.context<DockerEntityPorts>();
        switch (input.kind) {
          case "container":
            return yield* entities.inspectContainer(input).pipe(Effect.provideContext(ports));
          case "image":
            return yield* entities.inspectImage(input).pipe(Effect.provideContext(ports));
          case "network":
            return yield* entities.inspectNetwork(input).pipe(Effect.provideContext(ports));
          case "volume":
            return yield* entities.inspectVolume(input).pipe(Effect.provideContext(ports));
          default:
            return yield* Effect.fail(
              errors.BAD_REQUEST(standardErrorOptions("validation", `Unsupported entity kind: ${String(input.kind)}`)),
            );
        }
      });
  }

  @Implement(dockerContract.entity.stream)
  entityStream() {
    return procedure(dockerContract.entity.stream)
      .use(requireAuth())
      .handler(({ input }) => this.dockerEntityOrchestratorService.streamEntities(input.query ?? {}));
  }

}
