import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { filter, type Observable } from "rxjs";
import type { SystemMeshTopicService, MeshTopicNamespaceHandle } from "@/core/modules/mesh/services/system-mesh-topic.service";
import type { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";
import type {
    EventContracts,
    EventInput,
    EventOutput,
} from "@/core/modules/events/event-contract.builder";

export interface MeshCallManyOptions<TResponse> {
    timeoutMs?: number;
    organizationId?: string | null;
    stopWhen?: (response: TResponse, collected: TResponse[]) => boolean;
}

export interface MeshCallManyResult<TResponse> {
    correlationId: string;
    responses: TResponse[];
    stoppedEarly: boolean;
    reason: "timeout" | "killer_switch";
}

type UnsubscribeFn = () => void;

interface RequestEnvelope<TPayload> {
    correlationId: string;
    callerNodeId: string;
    payload: TPayload;
    emittedAt: string;
}

interface ResponseEnvelope<TPayload> {
    correlationId: string;
    responderNodeId: string;
    payload: TPayload;
    stopPropagation?: boolean;
    emittedAt: string;
}

interface CancelEnvelope {
    correlationId: string;
    callerNodeId: string;
    reason: "caller_stop" | "handler_stop";
    emittedAt: string;
}

/**
 * Internal-only base mesh abstraction for domain services.
 *
 * Pattern:
 * - Domain class extends this class
 * - Supplies namespace + contracts once
 * - Uses Rx stream APIs (emit/observe/subscribe)
 * - Supports direct call style with aggregation across instances
 * - Includes a kill-switch to stop propagation once a sufficient response is found
 */
export abstract class BaseMeshService<TContracts extends EventContracts> {
    protected readonly logger: Logger;

    private handle: MeshTopicNamespaceHandle<TContracts> | null = null;
    private readonly cleanupHandlers: UnsubscribeFn[] = [];
    private readonly cancelledCorrelations = new Set<string>();

    protected constructor(
        protected readonly meshTopicService: SystemMeshTopicService,
        protected readonly meshTopologyService: SystemMeshTopologyService,
        private readonly namespace: string,
        private readonly contracts: TContracts,
    ) {
        this.logger = new Logger(`${namespace}MeshService`);
    }

    protected initializeMeshNamespace(): void {
        this.handle = this.meshTopicService.registerNamespace({
            namespace: this.namespace,
            contracts: this.contracts,
        });
    }

    protected teardownMeshNamespace(): void {
        for (const cleanup of this.cleanupHandlers) {
            cleanup();
        }
        this.cleanupHandlers.length = 0;
        this.cancelledCorrelations.clear();
        this.handle = null;
    }

    protected emit<K extends keyof TContracts>(
        topic: K,
        input: EventInput<TContracts[K]>,
        output: EventOutput<TContracts[K]>,
        options?: { organizationId?: string | null; propagate?: boolean },
    ): void {
        const mesh = this.requireHandle();
        mesh.publish(topic, input, output, {
            organizationId: options?.organizationId ?? null,
            propagate: options?.propagate ?? true,
        });
    }

    protected observe$<K extends keyof TContracts>(
        topic: K,
        input: EventInput<TContracts[K]>,
    ): Observable<EventOutput<TContracts[K]>> {
        return this.requireHandle().observe$(topic, input);
    }

    protected registerCallHandler<
        KReq extends keyof TContracts,
        KRes extends keyof TContracts,
        KCancel extends keyof TContracts,
        TReqPayload,
        TResPayload,
    >(
        requestTopic: KReq,
        responseTopic: KRes,
        cancelTopic: KCancel,
        options: { organizationId?: string | null },
        handler: (input: {
            correlationId: string;
            callerNodeId: string;
            payload: TReqPayload;
        }) => Promise<{ payload: TResPayload; stopPropagation?: boolean }> | { payload: TResPayload; stopPropagation?: boolean },
    ): void {
        const mesh = this.requireHandle();
        const localNode = this.meshTopologyService.getLocalNode();
        const scopedOrganizationId = options.organizationId ?? null;

        const cancelSubscription = mesh.observe$(cancelTopic, { organizationId: scopedOrganizationId } as EventInput<TContracts[KCancel]>).subscribe((event) => {
            const payload = event as unknown as CancelEnvelope;
            this.cancelledCorrelations.add(payload.correlationId);
        });

        const requestSubscription = mesh
            .observe$(requestTopic, { organizationId: scopedOrganizationId } as EventInput<TContracts[KReq]>)
            .subscribe((event) => {
                const request = event as unknown as RequestEnvelope<TReqPayload>;
                if (this.cancelledCorrelations.has(request.correlationId)) {
                    return;
                }

                void Promise.resolve(handler({
                    correlationId: request.correlationId,
                    callerNodeId: request.callerNodeId,
                    payload: request.payload,
                }))
                    .then((result) => {
                        if (this.cancelledCorrelations.has(request.correlationId)) {
                            return;
                        }

                        const response: ResponseEnvelope<TResPayload> = {
                            correlationId: request.correlationId,
                            responderNodeId: localNode.nodeId,
                            payload: result.payload,
                            stopPropagation: result.stopPropagation ?? false,
                            emittedAt: new Date().toISOString(),
                        };

                        mesh.publish(
                            responseTopic,
                            { organizationId: scopedOrganizationId, correlationId: request.correlationId } as EventInput<TContracts[KRes]>,
                            response as EventOutput<TContracts[KRes]>,
                            { organizationId: scopedOrganizationId },
                        );

                        if (result.stopPropagation) {
                            this.broadcastKillSwitch(cancelTopic, request.correlationId, scopedOrganizationId, "handler_stop");
                        }
                    })
                    .catch(() => {
                        // Best-effort handler execution; malformed payloads or local failures should not crash the bus.
                    });
            });

        this.cleanupHandlers.push(() => {cancelSubscription.unsubscribe()});
        this.cleanupHandlers.push(() => {requestSubscription.unsubscribe()});
    }

    protected async callMany<
        KReq extends keyof TContracts,
        KRes extends keyof TContracts,
        KCancel extends keyof TContracts,
        TReqPayload,
        TResPayload,
    >(
        requestTopic: KReq,
        responseTopic: KRes,
        cancelTopic: KCancel,
        payload: TReqPayload,
        options?: MeshCallManyOptions<TResPayload>,
    ): Promise<MeshCallManyResult<TResPayload>> {
        const mesh = this.requireHandle();
        const localNode = this.meshTopologyService.getLocalNode();

        const correlationId = randomUUID();
        const organizationId = options?.organizationId ?? null;
        const timeoutMs = options?.timeoutMs ?? 1_500;

        const responses: TResPayload[] = [];
        let stoppedEarly = false;
        let reason: "timeout" | "killer_switch" = "timeout";

        await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
                responseSubscription.unsubscribe();
                resolve();
            }, timeoutMs);

            const responseSubscription = mesh
                .observe$(responseTopic, { organizationId, correlationId } as EventInput<TContracts[KRes]>)
                .pipe(
                    filter((event) => {
                        const envelope = event as unknown as ResponseEnvelope<TResPayload>;
                        return envelope.correlationId === correlationId;
                    }),
                )
                .subscribe((event) => {
                    const envelope = event as unknown as ResponseEnvelope<TResPayload>;
                    responses.push(envelope.payload);

                    const explicitStop = envelope.stopPropagation === true;
                    const predicateStop = options?.stopWhen?.(envelope.payload, responses) ?? false;
                    if (explicitStop || predicateStop) {
                        stoppedEarly = true;
                        reason = "killer_switch";
                        this.broadcastKillSwitch(cancelTopic, correlationId, organizationId, "caller_stop");
                        clearTimeout(timeout);
                        responseSubscription.unsubscribe();
                        resolve();
                    }
                });

            const requestEnvelope: RequestEnvelope<TReqPayload> = {
                correlationId,
                callerNodeId: localNode.nodeId,
                payload,
                emittedAt: new Date().toISOString(),
            };

            mesh.publish(
                requestTopic,
                { organizationId, correlationId } as EventInput<TContracts[KReq]>,
                requestEnvelope as EventOutput<TContracts[KReq]>,
                { organizationId },
            );
        });

        return {
            correlationId,
            responses,
            stoppedEarly,
            reason,
        };
    }

    private broadcastKillSwitch<KCancel extends keyof TContracts>(
        cancelTopic: KCancel,
        correlationId: string,
        organizationId: string | null,
        reason: "caller_stop" | "handler_stop",
    ): void {
        const mesh = this.requireHandle();
        const localNode = this.meshTopologyService.getLocalNode();
        const cancelEnvelope: CancelEnvelope = {
            correlationId,
            callerNodeId: localNode.nodeId,
            reason,
            emittedAt: new Date().toISOString(),
        };

        this.cancelledCorrelations.add(correlationId);

        mesh.publish(
            cancelTopic,
            { organizationId, correlationId } as EventInput<TContracts[KCancel]>,
            cancelEnvelope as EventOutput<TContracts[KCancel]>,
            { organizationId },
        );
    }

    private requireHandle(): MeshTopicNamespaceHandle<TContracts> {
        if (!this.handle) {
            throw new Error(`Mesh namespace '${this.namespace}' is not initialized`);
        }
        return this.handle;
    }
}
