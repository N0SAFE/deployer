import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { Subscription } from "rxjs";
import { Observable } from "rxjs";
import z from "zod/v4";
import { dockerRuntimeEventSchema, type DockerRuntimeEvent } from "@repo/contracts-entities";
import { AppLogger } from "@repo/logger";
import { contractBuilder } from "@repo/nest-events";
import { BaseMeshService, InternalBaseMeshService } from "@/core/modules/mesh/services/base-mesh.service";
import { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { DockerDomainRuntimeEventsService } from "../events/docker-domain-runtime-events.service";

const runtimeTopicInputSchema = z.object({
});

const dockerRuntimeMeshContracts = {
    runtimeEventBroadcast: contractBuilder()
        .input(runtimeTopicInputSchema)
        .output(dockerRuntimeEventSchema)
        .build(),
} as const;

@Injectable()
export class DockerRuntimeMeshRelayService
    extends InternalBaseMeshService<typeof dockerRuntimeMeshContracts, Record<string, never>>
    implements OnModuleInit, OnModuleDestroy {
    private readonly apiLogger = new AppLogger("api").scope(DockerRuntimeMeshRelayService.name);

    private readonly debugLogger = this.apiLogger.createContextFilterLogger({
        defaultClassName: DockerRuntimeMeshRelayService.name,
        filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
        channel: "docker-runtime-relay",
    });

    private localRelaySubscription: Subscription | null = null;
    private activeRuntimeObserverCount = 0;
    private relayedEventCount = 0;

    constructor(
        meshTopicService: SystemMeshTopicService,
        meshTopologyService: SystemMeshTopologyService,
        private readonly dockerDomainRuntimeEventsService: DockerDomainRuntimeEventsService,
    ) {
        super(meshTopicService, meshTopologyService, "docker-runtime-stream", dockerRuntimeMeshContracts, {});
    }

    onModuleInit(): void {
        this.initializeMeshNamespace();
    }

    onModuleDestroy(): void {
        this.stopLocalDockerRelay();
        this.activeRuntimeObserverCount = 0;
        this.teardownMeshNamespace();
    }

    observeRuntimeEvents(): Observable<DockerRuntimeEvent> {
        return new Observable<DockerRuntimeEvent>((subscriber) => {
            this.activeRuntimeObserverCount += 1;
            this.debug("observeRuntimeEvents", {
                phase: "observer_subscribe",
                activeRuntimeObserverCount: this.activeRuntimeObserverCount,
            });

            if (this.activeRuntimeObserverCount === 1) {
                this.startLocalDockerRelay();
            }

            let downstreamSubscription: Subscription | null = null;
            try {
                downstreamSubscription = this.handle!.observe$("runtimeEventBroadcast", {}).subscribe(subscriber);
            } catch (error) {
                // Roll back side effects when setup fails to prevent the local relay
                // running indefinitely without consumers — the original source of the
                // rate-limit flood.
                this.activeRuntimeObserverCount = Math.max(0, this.activeRuntimeObserverCount - 1);
                if (this.activeRuntimeObserverCount === 0) {
                    this.stopLocalDockerRelay();
                }
                subscriber.error(error);
                return;
            }

            return () => {
                downstreamSubscription?.unsubscribe();
                this.activeRuntimeObserverCount = Math.max(0, this.activeRuntimeObserverCount - 1);
                this.debug("observeRuntimeEvents", {
                    phase: "observer_unsubscribe",
                    activeRuntimeObserverCount: this.activeRuntimeObserverCount,
                });

                if (this.activeRuntimeObserverCount === 0) {
                    this.stopLocalDockerRelay();
                }
            };
        });
    }

    relayRuntimeEvent(event: DockerRuntimeEvent): void {
        if (!this.handle) return;
        this.handle.publish(
            "runtimeEventBroadcast",
            {},
            this.enrichEventWithNodeId(event),
            { propagate: true },
        );
    }

    private startLocalDockerRelay(): void {
        if (this.localRelaySubscription) {
            this.debug("startLocalDockerRelay", {
                phase: "relay_already_running",
            });
            return;
        }

        this.debug("startLocalDockerRelay", {
            phase: "relay_start",
        });

        this.localRelaySubscription = this.dockerDomainRuntimeEventsService.stream({}).subscribe({
            next: (event) => {
                this.relayedEventCount += 1;
                if (this.shouldTraceEvent(this.relayedEventCount)) {
                    this.debug("startLocalDockerRelay", {
                        phase: "relay_event",
                        count: this.relayedEventCount,
                        source: event.source,
                        action: event.action,
                        actorId: event.actorId,
                        eventId: event.eventId,
                    });
                }

                if (this.handle) {
                    this.handle.publish(
                        "runtimeEventBroadcast",
                        {},
                        this.enrichEventWithNodeId(event),
                        { propagate: true },
                    );
                }
            },
            error: (error) => {
                this.debug("startLocalDockerRelay", {
                    phase: "relay_error",
                    message: error instanceof Error ? error.message : String(error),
                });
                // stream retries internally; this branch is best-effort safety.
            },
        });
    }

    private stopLocalDockerRelay(): void {
        this.debug("stopLocalDockerRelay", {
            phase: "relay_stop",
            relayedEventCount: this.relayedEventCount,
        });
        this.localRelaySubscription?.unsubscribe();
        this.localRelaySubscription = null;
    }

    private enrichEventWithNodeId(event: DockerRuntimeEvent): DockerRuntimeEvent {
        const localNodeId = this.meshTopologyService.getLocalNode().nodeId;

        return dockerRuntimeEventSchema.parse({
            ...event,
            actorAttributes: {
                ...event.actorAttributes,
                meshNodeId: localNodeId,
            },
        });
    }

    private shouldTraceEvent(count: number): boolean {
        return count <= 20 || count % 100 === 0;
    }

    private debug(source: unknown, context?: Record<string, unknown>): void {
        this.debugLogger.debug(source, context);
    }
}
