import { Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { MeshCallManyOptions, MeshCallManyResult, MeshQueryHandler } from "@deployer/shared/core/modules/mesh/services/base-mesh.service";
import { makeMeshNamespace, type MeshNamespace, type MeshNamespaceTopology } from "@deployer/shared/core/modules/mesh/services/mesh-namespace";
import { SystemMeshTopicService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { dockerContainerMeshContracts } from "./docker-container-mesh.contracts";
import type { DockerContainerListRequestPayload, DockerContainerInspectRequestPayload, DockerContainerListResponsePayload, DockerContainerInspectResponsePayload, DockerRuntimeCatalogRequestPayload, DockerRuntimeCatalogResponsePayload } from "./docker-container-mesh.contracts";

export class DockerContainerMeshService implements OnModuleInit, OnModuleDestroy {
    private readonly meshNamespace: MeshNamespace<typeof dockerContainerMeshContracts>;

    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        this.meshNamespace = makeMeshNamespace({
            topics: meshTopicService,
            topology: meshTopologyService as unknown as MeshNamespaceTopology,
            namespace: "docker-container-internal",
            contracts: dockerContainerMeshContracts,
            logger: new Logger("docker-container-internalMeshService"),
        });
    }

    private registerCallHandler<TRequest, TResponse>(
        requestTopic: keyof typeof dockerContainerMeshContracts,
        responseTopic: keyof typeof dockerContainerMeshContracts,
        cancelTopic: keyof typeof dockerContainerMeshContracts,
        _options: Record<string, never>,
        handler: MeshQueryHandler<TRequest, TResponse>,
    ): void {
        this.meshNamespace.registerCallHandler(requestTopic, responseTopic, cancelTopic, handler);
    }

    private callManyOnTopics<TRequest, TResponse>(
        requestTopic: keyof typeof dockerContainerMeshContracts,
        responseTopic: keyof typeof dockerContainerMeshContracts,
        cancelTopic: keyof typeof dockerContainerMeshContracts,
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

    registerListContainersHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerContainerListRequestPayload;
        }) =>
            | { payload: DockerContainerListResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerListResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler(
            "listContainersRequest",
            "listContainersResponse",
            "listContainersCancel",
            {},
            handler,
        );
    }

    registerInspectContainerHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerContainerInspectRequestPayload;
        }) =>
            | { payload: DockerContainerInspectResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerContainerInspectResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler(
            "inspectContainerRequest",
            "inspectContainerResponse",
            "inspectContainerCancel",
            {},
            handler,
        );
    }

    registerRuntimeCatalogHandler(
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: DockerRuntimeCatalogRequestPayload;
        }) =>
            | { payload: DockerRuntimeCatalogResponsePayload; stopPropagation?: boolean }
            | Promise<{ payload: DockerRuntimeCatalogResponsePayload; stopPropagation?: boolean }>,
    ): void {
        this.registerCallHandler(
            "runtimeCatalogRequest",
            "runtimeCatalogResponse",
            "runtimeCatalogCancel",
            {},
            handler,
        );
    }

    listContainersAcrossInstances(
        payload: DockerContainerListRequestPayload,
        options?: {
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerContainerListResponsePayload>> {
        return this.callManyOnTopics(
            "listContainersRequest",
            "listContainersResponse",
            "listContainersCancel",
            payload,
            {
                timeoutMs: options?.timeoutMs ?? 1_500,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }

    inspectContainerAcrossInstances(
        payload: DockerContainerInspectRequestPayload,
        options?: {
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerContainerInspectResponsePayload>> {
        return this.callManyOnTopics(
            "inspectContainerRequest",
            "inspectContainerResponse",
            "inspectContainerCancel",
            payload,
            {
                timeoutMs: options?.timeoutMs ?? 1_500,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }

    listRuntimeCatalogAcrossInstances(
        payload: DockerRuntimeCatalogRequestPayload,
        options?: {
            timeoutMs?: number;
            maxCollectedResponses?: number;
        },
    ): Promise<MeshCallManyResult<DockerRuntimeCatalogResponsePayload>> {
        return this.callManyOnTopics(
            "runtimeCatalogRequest",
            "runtimeCatalogResponse",
            "runtimeCatalogCancel",
            payload,
            {
                timeoutMs: options?.timeoutMs ?? 2_000,
                maxCollectedResponses: options?.maxCollectedResponses,
            },
        );
    }
}