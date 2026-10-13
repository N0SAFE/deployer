import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { DockerRepository } from "../../../repositories/facade/docker.repository";
import { DockerContainerMeshService } from "./docker-container-mesh.service";
import { DockerContainerRuntimeService } from "../runtime/docker-container-runtime.service";
import { DockerContainerRuntimeMeshService } from "./docker-container-runtime-mesh.service";

@Injectable()
export class DockerMeshHandlerRegistrar implements OnModuleInit {
    private readonly logger = new Logger(DockerMeshHandlerRegistrar.name);

    constructor(
        private readonly dockerContainerMeshService: DockerContainerMeshService,
        private readonly dockerContainerRuntimeMeshService: DockerContainerRuntimeMeshService,
        private readonly dockerContainerRuntimeService: DockerContainerRuntimeService,
        private readonly dockerRepository: DockerRepository,
        private readonly systemMeshTopologyService: SystemMeshTopologyService,
    ) {}

    onModuleInit(): void {
        const localNodeId = this.systemMeshTopologyService.getLocalNode().nodeId;

        this.dockerContainerMeshService.registerListContainersHandler(async ({ payload }) => {
            const [result, daemonId] = await Promise.all([
                this.dockerRepository.listContainers(payload.query),
                this.dockerRepository.getLocalDockerDaemonId(),
            ]);

            return {
                payload: {
                    ...result,
                    responderNodeId: localNodeId,
                    responderDaemonId: daemonId,
                },
            };
        });

        this.dockerContainerMeshService.registerInspectContainerHandler(async ({ payload }) => {
            const detail = await this.dockerRepository.inspectContainer(payload.query.containerId);

            return {
                payload: {
                    detail,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerMeshService.registerRuntimeCatalogHandler(async () => {
            const catalog = await this.dockerRepository.getRuntimeCatalogSnapshot();

            return {
                payload: {
                    catalog,
                    responderNodeId: localNodeId,
                },
            };
        });

        this.dockerContainerRuntimeMeshService.registerLogsSnapshotHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.listContainerLogsSnapshot(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerProcessesSnapshotHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.listContainerProcesses(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerProcessLogsSnapshotHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.listContainerProcessLogsSnapshot(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerFilesSnapshotHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.listContainerFiles(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerReadFileSnapshotHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.readContainerFile(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerWriteFileHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.writeContainerFile(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerDeletePathHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.deleteContainerPath(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerRenamePathHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.renameContainerPath(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerCreateDirectoryHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.createContainerDirectory(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerTerminalOpenHandler(async ({ payload }) => {
            const session = await this.dockerContainerRuntimeService.openContainerTerminalSession(payload.body);

            return {
                payload: {
                    session,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerTerminalEventsHandler(async ({ payload }) => {
            const snapshot = await this.dockerContainerRuntimeService.listContainerTerminalSessionEvents(payload.query);

            return {
                payload: {
                    snapshot,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerTerminalInputHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.sendContainerTerminalInput(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerTerminalCloseHandler(async ({ payload }) => {
            const ack = await this.dockerContainerRuntimeService.closeContainerTerminalSession(payload.body);

            return {
                payload: {
                    ack,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.dockerContainerRuntimeMeshService.registerImageInspectHandler(async ({ payload }) => {
            const detail = await this.dockerRepository.inspectImage(payload.query.imageId);

            return {
                payload: {
                    detail,
                    responderNodeId: localNodeId,
                },
                stopPropagation: true,
            };
        });

        this.logger.log("Docker mesh handlers registered (list/inspect/runtime/runtime-ops)");
    }
}
