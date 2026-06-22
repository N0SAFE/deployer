import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { EventContracts } from "@/core/modules/events/event-contract.builder";
import type {
    MeshTopicNamespaceDefinition,
    MeshTopicNamespaceHandle,
} from "../domain/mesh-topic-types";
import { MeshTopicRegistryService } from "../services/mesh-topic-registry.service";
import { MeshTopicEnvelopeHandlerService } from "../services/mesh-topic-envelope-handler.service";
import { MeshTopicQueryBusService } from "../services/mesh-topic-query-bus.service";
import { SystemMeshTopologyService } from "../../system-mesh-topology/orchestrator/system-mesh-topology.service";

/**
 * Façade orchestratrice du mesh-topic.
 *
 * Responsabilités :
 *  - Câbler le handler d'envelopes sur le plan de contrôle mesh (OnModuleInit)
 *  - Drainer les queries en cours au shutdown (OnModuleDestroy)
 *  - Exposer registerNamespace() et hasNamespace() comme API publique
 *
 * Zéro logique métier ici.
 */
@Injectable()
export class SystemMeshTopicService implements OnModuleInit, OnModuleDestroy {
    private unsubscribeFromMesh: (() => void) | null = null;

    constructor(
        private readonly meshTopology: SystemMeshTopologyService,
        private readonly registry: MeshTopicRegistryService,
        private readonly envelopeHandler: MeshTopicEnvelopeHandlerService,
        private readonly queryBus: MeshTopicQueryBusService,
    ) {}

    onModuleInit(): void {
        this.unsubscribeFromMesh = this.meshTopology.registerControlEnvelopeHandler(
            (envelope) => {this.envelopeHandler.handle(envelope)},
        );
    }

    onModuleDestroy(): void {
        this.unsubscribeFromMesh?.();
        this.unsubscribeFromMesh = null;
        this.queryBus.drainOnShutdown();
    }

    registerNamespace<TContracts extends EventContracts>(
        definition: MeshTopicNamespaceDefinition<TContracts>,
    ): MeshTopicNamespaceHandle<TContracts> {
        return this.registry.register(definition);
    }

    hasNamespace(namespace: string): boolean {
        return this.registry.has(namespace);
    }
}