import { Logger, type OnModuleInit } from "@nestjs/common";
import type { DockerContainerMeshService } from "./docker-container-mesh.service";
import type { DockerContainerRuntimeMeshService } from "./docker-container-runtime-mesh.service";
import { buildMeshHandlers, type LocalNodeOperations } from "./mesh-handlers";

/**
 * Registers this node's answers on the mesh when the application starts. What each answer is lives in
 * `buildMeshHandlers`; this only connects them to the two mesh services under this node's id.
 */
export class DockerMeshHandlerRegistrar implements OnModuleInit {
    private readonly logger = new Logger(DockerMeshHandlerRegistrar.name);

    constructor(
        private readonly containerMesh: DockerContainerMeshService,
        private readonly runtimeMesh: DockerContainerRuntimeMeshService,
        private readonly local: LocalNodeOperations,
        private readonly localNodeId: () => string,
    ) {}

    onModuleInit(): void {
        const handlers = buildMeshHandlers(this.local, this.localNodeId());

        this.containerMesh.registerListContainersHandler(handlers.container.listContainers);
        this.containerMesh.registerInspectContainerHandler(handlers.container.inspectContainer);
        this.containerMesh.registerRuntimeCatalogHandler(handlers.container.runtimeCatalog);

        this.runtimeMesh.registerLogsSnapshotHandler(handlers.runtime.logsSnapshot);
        this.runtimeMesh.registerProcessesSnapshotHandler(handlers.runtime.processesSnapshot);
        this.runtimeMesh.registerProcessLogsSnapshotHandler(handlers.runtime.processLogsSnapshot);
        this.runtimeMesh.registerFilesSnapshotHandler(handlers.runtime.filesSnapshot);
        this.runtimeMesh.registerReadFileSnapshotHandler(handlers.runtime.readFileSnapshot);
        this.runtimeMesh.registerWriteFileHandler(handlers.runtime.writeFile);
        this.runtimeMesh.registerDeletePathHandler(handlers.runtime.deletePath);
        this.runtimeMesh.registerRenamePathHandler(handlers.runtime.renamePath);
        this.runtimeMesh.registerCreateDirectoryHandler(handlers.runtime.createDirectory);
        this.runtimeMesh.registerTerminalOpenHandler(handlers.runtime.terminalOpen);
        this.runtimeMesh.registerTerminalEventsHandler(handlers.runtime.terminalEvents);
        this.runtimeMesh.registerTerminalInputHandler(handlers.runtime.terminalInput);
        this.runtimeMesh.registerTerminalCloseHandler(handlers.runtime.terminalClose);
        this.runtimeMesh.registerImageInspectHandler(handlers.runtime.imageInspect);

        this.logger.log("Docker mesh handlers registered (list/inspect/runtime/runtime-ops)");
    }
}
