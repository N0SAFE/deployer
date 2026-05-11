import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { EventContracts } from "@/core/modules/events/event-contract.builder";
import type { SystemMeshTopologyService } from "../../system-mesh-topology/orchestrator/system-mesh-topology.service";
import type { MeshTopicNamespaceRuntime } from "../runtime/mesh-topic-namespace-runtime";
import {
    MeshTopicQueryInvalidResponseError,
    MeshTopicQueryTimeoutError,
} from "../domain/mesh-topic-errors";
import type {
    MeshQueryHandlerRegistration,
    MeshTopicRequestOptions,
    PendingMeshQuery,
} from "../domain/mesh-topic-types";
import type { MeshControlEnvelope } from "@repo/contracts-entities";

/**
 * Bus Request/Response over mesh.
 *
 * - `request()` : envoie une query_request et attend la query_response
 *   avec timeout configurable (défaut 8s).
 * - `registerHandler()` : enregistre un handler local pour répondre
 *   aux query_requests reçues depuis d'autres nœuds.
 *
 * Chaque pending query est identifiée par un queryId UUID unique.
 */
@Injectable()
export class MeshTopicQueryBusService {
    private readonly pending = new Map<string, PendingMeshQuery>();
    private readonly handlers = new Map<string, MeshQueryHandlerRegistration>();

    constructor(
        private readonly meshTopology: SystemMeshTopologyService,
    ) {}

    // ─── Request ──────────────────────────────────────────────────────────────

    request(
        namespace: string,
        runtime: MeshTopicNamespaceRuntime<EventContracts>,
        requestTopic: string,
        responseTopic: string,
        input: unknown,
        options?: MeshTopicRequestOptions,
    ): Promise<unknown> {
        const queryId = randomUUID();
        const localNode = this.meshTopology.getLocalNode();
        const timeoutMs = options?.timeoutMs ?? 8_000;

        const validatedInput = runtime.parseInput(requestTopic as never, input);

        return new Promise<unknown>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(queryId);
                reject(new MeshTopicQueryTimeoutError(namespace, responseTopic));
            }, timeoutMs);

            this.pending.set(queryId, {
                namespace,
                responseTopic,
                resolve,
                reject,
                timeout,
            });

            this.meshTopology.publishControlEnvelope({
                envelopeId: randomUUID(),
                organizationId: options?.organizationId ?? null,
                type: "event_publish",
                sourceNodeId: localNode.nodeId,
                targetNodeId: null,
                partitionKey: options?.partitionKey,
                traceId: options?.traceId,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {
                    kind: "topic_query_request",
                    queryId,
                    namespace,
                    requestTopic,
                    responseTopic,
                    input: validatedInput,
                },
            });
        });
    }

    // ─── Handler registration ─────────────────────────────────────────────────

    registerHandler(
        namespace: string,
        runtime: MeshTopicNamespaceRuntime<EventContracts>,
        requestTopic: string,
        responseTopic: string,
        handler: (input: unknown) => Promise<unknown>,
    ): () => void {
        const key = this.handlerKey(namespace, requestTopic);
        this.handlers.set(key, {
            namespace,
            requestTopic,
            responseTopic,
            handler,
            parseInput: (topic, input) => runtime.parseInput(topic as never, input),
            parseOutput: (topic, output) => runtime.parseOutput(topic as never, output),
        });

        return () => {
            const current = this.handlers.get(key);
            if (current?.handler === handler) this.handlers.delete(key);
        };
    }

    // ─── Incoming dispatch (appelé par MeshTopicEnvelopeHandlerService) ────────

    handleQueryRequest(envelope: MeshControlEnvelope): void {
        const payload = envelope.payload;
        const namespace = this.str(payload.namespace);
        const requestTopic = this.str(payload.requestTopic);
        const responseTopic = this.str(payload.responseTopic);
        const queryId = this.str(payload.queryId);

        if (!namespace || !requestTopic || !responseTopic || !queryId) return;

        const registration = this.handlers.get(this.handlerKey(namespace, requestTopic));
        if (!registration) return;

        let parsedInput: unknown;
        try {
            parsedInput = registration.parseInput(requestTopic, payload.input);
        } catch {
            return;
        }

        void registration
            .handler(parsedInput)
            .then((output) => registration.parseOutput(responseTopic, output))
            .then((validated) => {
                const localNode = this.meshTopology.getLocalNode();
                this.meshTopology.publishControlEnvelope({
                    envelopeId: randomUUID(),
                    organizationId: envelope.organizationId ?? null,
                    type: "event_publish",
                    sourceNodeId: localNode.nodeId,
                    targetNodeId: envelope.sourceNodeId,
                    partitionKey: envelope.partitionKey,
                    traceId: envelope.traceId,
                    hop: 0,
                    maxHops: 16,
                    emittedAt: new Date().toISOString(),
                    payload: {
                        kind: "topic_query_response",
                        queryId,
                        namespace,
                        responseTopic,
                        output: validated,
                    },
                });
            })
            .catch(() => {
                // Timeout côté caller couvre l'absence de réponse
            });
    }

    handleQueryResponse(envelope: MeshControlEnvelope): void {
        const payload = envelope.payload;
        const queryId = this.str(payload.queryId);
        const namespace = this.str(payload.namespace);
        const responseTopic = this.str(payload.responseTopic);

        if (!queryId || !namespace || !responseTopic) return;

        const pending = this.pending.get(queryId);
        if (!pending) return;
        if (pending.namespace !== namespace || pending.responseTopic !== responseTopic) return;

        try {
            // La validation du output est faite dans handleQueryRequest côté serveur
            // Ici on fait confiance au payload validé
            clearTimeout(pending.timeout);
            this.pending.delete(queryId);
            pending.resolve(payload.output);
        } catch {
            clearTimeout(pending.timeout);
            this.pending.delete(queryId);
            pending.reject(new MeshTopicQueryInvalidResponseError());
        }
    }

    drainOnShutdown(): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timeout);
            pending.reject(new Error("mesh_topic_service_shutdown"));
        }
        this.pending.clear();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private handlerKey(namespace: string, requestTopic: string): string {
        return `${namespace}:${requestTopic}`;
    }

    private str(value: unknown): string | null {
        return typeof value === "string" && value.length > 0 ? value : null;
    }
}