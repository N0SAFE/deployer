import { Inject, Injectable } from "@nestjs/common";
import {
    meshEventPublishPayloadSchema,
    type MeshControlEnvelope,
} from "@repo/contracts-entities";
import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
import { meshTopicEventPayloadSchema } from "../domain/mesh-topic-types";
import { MeshTopicDedupStore } from "../../../shared/primitives/mesh-topic-dedup-store";
import { MeshTopicRegistryService } from "./mesh-topic-registry.service";
import { MeshTopicQueryBusService } from "./mesh-topic-query-bus.service";
import { SystemMeshTopologyService } from "../../system-mesh-topology/orchestrator/system-mesh-topology.service";

/**
 * Dispatch des envelopes mesh entrantes vers le bon handler :
 *  - topic_event          → runtime local du namespace
 *  - topic_query_request  → MeshTopicQueryBusService.handleQueryRequest
 *  - topic_query_response → MeshTopicQueryBusService.handleQueryResponse
 *
 * Applique déduplication (eventId) et ordering (sequence/version).
 */
@Injectable()
export class MeshTopicEnvelopeHandlerService {
    private readonly dedup: MeshTopicDedupStore;

    constructor(
        @Inject(CLOCK_TOKEN) clock: Clock,
        private readonly registry: MeshTopicRegistryService,
        private readonly queryBus: MeshTopicQueryBusService,
        private readonly meshTopology: SystemMeshTopologyService,
    ) {
        this.dedup = new MeshTopicDedupStore(clock);
    }

    handle(envelope: MeshControlEnvelope): void {
        if (envelope.type !== "event_publish") return;

        const localNode = this.meshTopology.getLocalNode();
        if (envelope.sourceNodeId === localNode.nodeId) return;

        const kind = this.str(envelope.payload.kind) ?? "topic_event";

        if (kind === "topic_query_request") {
            this.queryBus.handleQueryRequest(envelope);
            return;
        }

        if (kind === "topic_query_response") {
            this.queryBus.handleQueryResponse(envelope);
            return;
        }

        this.handleTopicEvent(envelope);
    }

    private handleTopicEvent(envelope: MeshControlEnvelope): void {
        const parsedPublish = meshEventPublishPayloadSchema.safeParse(envelope.payload);
        if (!parsedPublish.success) return;

        const { event, sequence } = parsedPublish.data;

        // Déduplication par eventId — retourne false si déjà vu
        if (!this.dedup.checkAndMarkProcessed(event.eventId)) return;

        const parsedTopic = meshTopicEventPayloadSchema.safeParse(event.payload);
        if (!parsedTopic.success) return;

        // Ordering par agrégat
        const aggregateKey = `${event.aggregateType}:${event.aggregateId}:${event.eventType}`;
        const version = this.parseVersion(event.version);

        if (this.dedup.isOutOfOrder(aggregateKey, { sequence, version })) return;

        const { namespace, topic, input, output } = parsedTopic.data;
        const runtime = this.registry.getRuntime(namespace);
        if (!runtime) return;

        try {
            runtime.emit(topic as never, input, output);
            this.dedup.markAggregateProgress(aggregateKey, { sequence, version });
        } catch {
            // Ignore — contrat incompatible ou payload malformé
        }
    }

    private parseVersion(version: string): number | undefined {
        if (!/^\d+$/.test(version)) return undefined;
        const n = Number.parseInt(version, 10);
        return Number.isSafeInteger(n) ? n : undefined;
    }

    private str(value: unknown): string | null {
        return typeof value === "string" && value.length > 0 ? value : null;
    }
}