import { Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { MeshCallManyOptions, MeshCallManyResult, MeshQueryHandler } from "@deployer/shared/core/modules/mesh/services/base-mesh.service";
import { makeMeshNamespace, type MeshNamespace, type MeshNamespaceTopology } from "@deployer/shared/core/modules/mesh/services/mesh-namespace";
import { SystemMeshTopicService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { dockerContainerRuntimeMeshContracts } from "./docker-container-runtime-mesh.contracts";
import type { DockerContainerLogsSnapshotRequestPayload, DockerContainerLogsSnapshotResponsePayload, DockerContainerProcessesSnapshotRequestPayload, DockerContainerProcessesSnapshotResponsePayload, DockerContainerProcessLogsSnapshotRequestPayload, DockerContainerProcessLogsSnapshotResponsePayload, DockerContainerFilesSnapshotRequestPayload, DockerContainerFilesSnapshotResponsePayload, DockerContainerReadFileSnapshotRequestPayload, DockerContainerReadFileSnapshotResponsePayload, DockerContainerWriteFileRequestPayload, DockerContainerWriteFileResponsePayload, DockerContainerDeletePathRequestPayload, DockerContainerDeletePathResponsePayload, DockerContainerRenamePathRequestPayload, DockerContainerRenamePathResponsePayload, DockerContainerCreateDirectoryRequestPayload, DockerContainerCreateDirectoryResponsePayload, DockerContainerTerminalOpenRequestPayload, DockerContainerTerminalOpenResponsePayload, DockerContainerTerminalEventsRequestPayload, DockerContainerTerminalEventsResponsePayload, DockerContainerTerminalInputRequestPayload, DockerContainerTerminalInputResponsePayload, DockerContainerTerminalCloseRequestPayload, DockerContainerTerminalCloseResponsePayload, DockerImageInspectRequestPayload, DockerImageInspectResponsePayload } from "./docker-container-runtime-mesh.contracts";

export class DockerContainerRuntimeMeshService implements OnModuleInit, OnModuleDestroy {
    private readonly meshNamespace: MeshNamespace<typeof dockerContainerRuntimeMeshContracts>;

    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        this.meshNamespace = makeMeshNamespace({
            topics: meshTopicService,
            topology: meshTopologyService as unknown as MeshNamespaceTopology,
            namespace: "docker-container-runtime-internal",
            contracts: dockerContainerRuntimeMeshContracts,
            logger: new Logger("docker-container-runtime-internalMeshService"),
        });
    }

    private registerCallHandler<TRequest, TResponse>(
        requestTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        responseTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        cancelTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        _options: Record<string, never>,
        handler: MeshQueryHandler<TRequest, TResponse>,
    ): void {
        this.meshNamespace.registerCallHandler(requestTopic, responseTopic, cancelTopic, handler);
    }

    private callManyOnTopics<TRequest, TResponse>(
        requestTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        responseTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        cancelTopic: keyof typeof dockerContainerRuntimeMeshContracts,
        payload: TRequest,
        options?: MeshCallManyOptions<TResponse>,
    ): Promise<MeshCallManyResult<TResponse>> {
        return this.meshNamespace.callMany(requestTopic, responseTopic, cancelTopic, payload, options);
    }

    onModuleInit(): void {
        this.meshNamespace.initialize();
    }

    onModuleDestroy(): void {
        this.meshNamespace.teardown();
    }

    registerLogsSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerLogsSnapshotRequestPayload }) =>
            | { payload: DockerContainerLogsSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerLogsSnapshotResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("logsSnapshotRequest", "logsSnapshotResponse", "logsSnapshotCancel", {
        }, handler);
    }

    registerProcessesSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerProcessesSnapshotRequestPayload }) =>
            | { payload: DockerContainerProcessesSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerProcessesSnapshotResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("processesSnapshotRequest", "processesSnapshotResponse", "processesSnapshotCancel", {
        }, handler);
    }

    registerProcessLogsSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerProcessLogsSnapshotRequestPayload }) =>
            | { payload: DockerContainerProcessLogsSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerProcessLogsSnapshotResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("processLogsSnapshotRequest", "processLogsSnapshotResponse", "processLogsSnapshotCancel", {
        }, handler);
    }

    registerFilesSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerFilesSnapshotRequestPayload }) =>
            | { payload: DockerContainerFilesSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerFilesSnapshotResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("filesSnapshotRequest", "filesSnapshotResponse", "filesSnapshotCancel", {
        }, handler);
    }

    registerReadFileSnapshotHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerReadFileSnapshotRequestPayload }) =>
            | { payload: DockerContainerReadFileSnapshotResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerReadFileSnapshotResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("readFileSnapshotRequest", "readFileSnapshotResponse", "readFileSnapshotCancel", {
        }, handler);
    }

    registerWriteFileHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerWriteFileRequestPayload }) =>
            | { payload: DockerContainerWriteFileResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerWriteFileResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("writeFileRequest", "writeFileResponse", "writeFileCancel", {
        }, handler);
    }

    registerDeletePathHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerDeletePathRequestPayload }) =>
            | { payload: DockerContainerDeletePathResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerDeletePathResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("deletePathRequest", "deletePathResponse", "deletePathCancel", {
        }, handler);
    }

    registerRenamePathHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerRenamePathRequestPayload }) =>
            | { payload: DockerContainerRenamePathResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerRenamePathResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("renamePathRequest", "renamePathResponse", "renamePathCancel", {
        }, handler);
    }

    registerCreateDirectoryHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerCreateDirectoryRequestPayload }) =>
            | { payload: DockerContainerCreateDirectoryResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerCreateDirectoryResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("createDirectoryRequest", "createDirectoryResponse", "createDirectoryCancel", {
        }, handler);
    }

    registerTerminalOpenHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalOpenRequestPayload }) =>
            | { payload: DockerContainerTerminalOpenResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalOpenResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("terminalOpenRequest", "terminalOpenResponse", "terminalOpenCancel", {
        }, handler);
    }

    registerTerminalEventsHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalEventsRequestPayload }) =>
            | { payload: DockerContainerTerminalEventsResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalEventsResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("terminalEventsRequest", "terminalEventsResponse", "terminalEventsCancel", {
        }, handler);
    }

    registerTerminalInputHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalInputRequestPayload }) =>
            | { payload: DockerContainerTerminalInputResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalInputResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("terminalInputRequest", "terminalInputResponse", "terminalInputCancel", {
        }, handler);
    }

    registerTerminalCloseHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerContainerTerminalCloseRequestPayload }) =>
            | { payload: DockerContainerTerminalCloseResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerTerminalCloseResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("terminalCloseRequest", "terminalCloseResponse", "terminalCloseCancel", {
        }, handler);
    }

    registerImageInspectHandler(
        handler: (input: { correlationId: string; callerNodeId: string; payload: DockerImageInspectRequestPayload }) =>
            | { payload: DockerImageInspectResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerImageInspectResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler("imageInspectRequest", "imageInspectResponse", "imageInspectCancel", {
        }, handler);
    }

    listContainerLogsSnapshotAcrossInstances(
        payload: DockerContainerLogsSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerLogsSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerLogsSnapshotResponsePayload>> {
        return this.callManyOnTopics("logsSnapshotRequest", "logsSnapshotResponse", "logsSnapshotCancel", payload, options);
    }

    listContainerProcessesSnapshotAcrossInstances(
        payload: DockerContainerProcessesSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerProcessesSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerProcessesSnapshotResponsePayload>> {
        return this.callManyOnTopics("processesSnapshotRequest", "processesSnapshotResponse", "processesSnapshotCancel", payload, options);
    }

    listContainerProcessLogsSnapshotAcrossInstances(
        payload: DockerContainerProcessLogsSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerProcessLogsSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerProcessLogsSnapshotResponsePayload>> {
        return this.callManyOnTopics("processLogsSnapshotRequest", "processLogsSnapshotResponse", "processLogsSnapshotCancel", payload, options);
    }

    listContainerFilesSnapshotAcrossInstances(
        payload: DockerContainerFilesSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerFilesSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerFilesSnapshotResponsePayload>> {
        return this.callManyOnTopics("filesSnapshotRequest", "filesSnapshotResponse", "filesSnapshotCancel", payload, options);
    }

    readContainerFileSnapshotAcrossInstances(
        payload: DockerContainerReadFileSnapshotRequestPayload,
        options?: MeshCallManyOptions<DockerContainerReadFileSnapshotResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerReadFileSnapshotResponsePayload>> {
        return this.callManyOnTopics("readFileSnapshotRequest", "readFileSnapshotResponse", "readFileSnapshotCancel", payload, options);
    }

    writeContainerFileAcrossInstances(
        payload: DockerContainerWriteFileRequestPayload,
        options?: MeshCallManyOptions<DockerContainerWriteFileResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerWriteFileResponsePayload>> {
        return this.callManyOnTopics("writeFileRequest", "writeFileResponse", "writeFileCancel", payload, options);
    }

    deleteContainerPathAcrossInstances(
        payload: DockerContainerDeletePathRequestPayload,
        options?: MeshCallManyOptions<DockerContainerDeletePathResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerDeletePathResponsePayload>> {
        return this.callManyOnTopics("deletePathRequest", "deletePathResponse", "deletePathCancel", payload, options);
    }

    renameContainerPathAcrossInstances(
        payload: DockerContainerRenamePathRequestPayload,
        options?: MeshCallManyOptions<DockerContainerRenamePathResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerRenamePathResponsePayload>> {
        return this.callManyOnTopics("renamePathRequest", "renamePathResponse", "renamePathCancel", payload, options);
    }

    createContainerDirectoryAcrossInstances(
        payload: DockerContainerCreateDirectoryRequestPayload,
        options?: MeshCallManyOptions<DockerContainerCreateDirectoryResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerCreateDirectoryResponsePayload>> {
        return this.callManyOnTopics("createDirectoryRequest", "createDirectoryResponse", "createDirectoryCancel", payload, options);
    }

    openContainerTerminalSessionAcrossInstances(
        payload: DockerContainerTerminalOpenRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalOpenResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalOpenResponsePayload>> {
        return this.callManyOnTopics("terminalOpenRequest", "terminalOpenResponse", "terminalOpenCancel", payload, options);
    }

    listContainerTerminalSessionEventsAcrossInstances(
        payload: DockerContainerTerminalEventsRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalEventsResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalEventsResponsePayload>> {
        return this.callManyOnTopics("terminalEventsRequest", "terminalEventsResponse", "terminalEventsCancel", payload, options);
    }

    sendContainerTerminalInputAcrossInstances(
        payload: DockerContainerTerminalInputRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalInputResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalInputResponsePayload>> {
        return this.callManyOnTopics("terminalInputRequest", "terminalInputResponse", "terminalInputCancel", payload, options);
    }

    closeContainerTerminalSessionAcrossInstances(
        payload: DockerContainerTerminalCloseRequestPayload,
        options?: MeshCallManyOptions<DockerContainerTerminalCloseResponsePayload>,
    ): Promise<MeshCallManyResult<DockerContainerTerminalCloseResponsePayload>> {
        return this.callManyOnTopics("terminalCloseRequest", "terminalCloseResponse", "terminalCloseCancel", payload, options);
    }

    inspectImageAcrossInstances(
        payload: DockerImageInspectRequestPayload,
        options?: MeshCallManyOptions<DockerImageInspectResponsePayload>,
    ): Promise<MeshCallManyResult<DockerImageInspectResponsePayload>> {
        return this.callManyOnTopics("imageInspectRequest", "imageInspectResponse", "imageInspectCancel", payload, options);
    }
}
