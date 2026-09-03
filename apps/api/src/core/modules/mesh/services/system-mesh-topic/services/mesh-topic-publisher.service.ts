import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { meshEventPublishPayloadSchema } from "@repo/contracts-entities";
import type { EventContracts, EventInput, EventOutput } from "@repo/nest-events";
import { SystemMeshTopologyService } from "../../system-mesh-topology/orchestrator/system-mesh-topology.service";
import { MeshTopicNamespaceRuntime } from "../runtime/mesh-topic-namespace-runtime";
import type { MeshTopicPublishOptions, MeshTopicEventPayload } from "../domain/mesh-topic-types";

/**
 * Publication d'un événement :
 *  1. Emit local dans le runtime (subscribers in-process)
 *  2. Sérialise en MeshEventPublishPayload
 *  3. Propage via publishControlEnvelope (sauf si propagate=false)
 */
@Injectable()
export class MeshTopicPublisherService {
    constructor(
        private readonly meshTopology: SystemMeshTopologyService,
    ) {}

    publish<TContracts extends EventContracts>(
        namespace: string,
        runtime: MeshTopicNamespaceRuntime<TContracts>,
        topic: string,
        input: EventInput<TContracts[string]>,
        output: EventOutput<TContracts[string]>,
        options?: MeshTopicPublishOptions,
    ): void {
        // 1. Emit local
        runtime.emit(topic, input, output);

        const sequence = runtime.getLastSequence(topic, input);
        const emittedAt = new Date().toISOString();

        const topicPayload: MeshTopicEventPayload = {
            namespace,
            topic,
            input,
            output,
        };

        // 2. Sérialise
        const parsedPayload = meshEventPublishPayloadSchema.parse({
            event: {
                eventId: randomUUID(),
                aggregateType: namespace,
                aggregateId: this.resolveAggregateId(topicPayload),
                eventType: topic,
                version: "1",
                occurredAt: emittedAt,
                ...(options?.traceId ? { traceId: options.traceId } : {}),
                payload: topicPayload,
                metadata: { namespace, topic },
            },
            sequence,
        });

        // 3. Propage
        if (options?.propagate === false) return;

        // Single-node fast path: when there are no remote peers, the
        // control plane has nothing to forward to. Local subscribers
        // already received the event via `runtime.emit()` above. Skipping
        // the control plane here prevents the `TokenBucket` (which caps
        // at 200 publishes/s) from being drained by self-only emissions
        // — the docker event stream alone can emit hundreds of
        // `event_publish` envelopes per second during container churn,
        // which would otherwise spam `Control envelope rate limit
        // exceeded` warnings and drop legitimate cross-node propagation.
        const remoteNodeCount = this.meshTopology
            .getMembershipSnapshot()
            .nodes.length;
        if (remoteNodeCount === 0) return;

        const localNode = this.meshTopology.getLocalNode();
        this.meshTopology.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "event_publish",
            sourceNodeId: localNode.nodeId,
            targetNodeId: null,
            partitionKey: options?.partitionKey,
            traceId: options?.traceId,
            hop: 0,
            maxHops: 16,
            emittedAt,
            payload: parsedPayload,
        });
    }

    /**
     * Résout l'aggregateId depuis les champs prioritaires de l'input.
     * Fallback : `namespace:topic`.
     */
    resolveAggregateId(payload: MeshTopicEventPayload): string {
        const prioritized = [
            "correlationId",
            "queryId",
            "deploymentId",
            "serviceId",
            "projectId",
            "organizationId",
            "id",
        ];
        for (const key of prioritized) {
            const candidate = payload.input[key];
            if (typeof candidate === "string" && candidate.trim().length > 0) {
                return candidate;
            }
        }
        return `${payload.namespace}:${payload.topic}`;
    }
}