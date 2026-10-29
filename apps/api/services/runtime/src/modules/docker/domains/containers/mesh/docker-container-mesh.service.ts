import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { InternalBaseMeshService, type MeshCallManyResult } from "@deployer/shared/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { dockerContainerMeshContracts } from "./docker-container-mesh.contracts";
import type { DockerContainerListRequestPayload, DockerContainerInspectRequestPayload, DockerContainerListResponsePayload, DockerContainerInspectResponsePayload, DockerRuntimeCatalogRequestPayload, DockerRuntimeCatalogResponsePayload } from "./docker-container-mesh.contracts";

@Injectable()
export class DockerContainerMeshService
    extends InternalBaseMeshService<typeof dockerContainerMeshContracts, Record<string, never>>
    implements OnModuleInit, OnModuleDestroy {
    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
    ) {
        super(meshTopicService, meshTopologyService, "docker-container-internal", dockerContainerMeshContracts, {});
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();
    }

    onModuleDestroy(): void {
        this.teardownMeshNamespace();
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