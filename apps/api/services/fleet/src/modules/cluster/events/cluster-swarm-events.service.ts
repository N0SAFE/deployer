/**
 * ClusterSwarmEventsService — event-driven SSE for the cluster page.
 *
 * Instead of polling on intervals, subscribes to Docker's native event
 * stream (docker.getEvents) and dispatches swarm-relevant events
 * (node, service, task changes) to pooled RxJS observables.
 *
 * Each subscriber gets: (1) the current state immediately (via
 * BehaviorSubject replay), then (2) incremental updates as swarm
 * events arrive from the Docker engine.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import {
    BehaviorSubject,
    Observable,
    Subject,
    filter,
    from,
    merge,
    mergeMap,
    share,
    timer,
} from "rxjs";
import { map } from "rxjs/operators";
import { CoreEventStreamPoolService } from "@repo/nest-events";
import { AbstractDomainEventStreamService } from "@repo/nest-events";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import { SwarmClusterService } from "@repo/nest-swarm";
import { SwarmFleetService } from "@repo/nest-swarm";
import { ClusterNodeInventoryRepository } from "@repo/nest-nodes/cluster-node-inventory.repository";
import type { ClusterSnapshot, SwarmServiceRuntime, SwarmTaskRuntime } from "@repo/contracts-entities";
import { clusterNodeInventoryRowSchema, type ClusterNodeInventoryRow } from "@repo/api-contracts";
import type { ClusterMasterView } from "@repo/api-contracts";

/** Docker engine event types relevant to swarm cluster state. */
const SWARM_EVENT_TYPES = new Set(["node", "service", "task"]);

interface DockerRawEvent {
    Type?: string;
    Action?: string;
    Actor?: { ID?: string; Attributes?: Record<string, string> };
    time?: number;
    timeNano?: number;
}

@Injectable()
export class ClusterSwarmEventsService
    extends AbstractDomainEventStreamService
    implements OnModuleInit, OnModuleDestroy
{
    protected readonly streamDomain = "cluster-swarm";
    private readonly logger = new Logger(ClusterSwarmEventsService.name);

    /** Hot observable of raw Docker events, shared across all streams. */
    private dockerEvents$: Observable<DockerRawEvent> | null = null;

    /** Subjects that hold current state and push on swarm events. */
    private readonly snapshotSubject = new BehaviorSubject<ClusterSnapshot | null>(null);
    private readonly nodesSubject = new BehaviorSubject<unknown[]>([]);
    private readonly masterSubject = new BehaviorSubject<ClusterMasterView>(null);
    private readonly servicesSubject = new BehaviorSubject<SwarmServiceRuntime[]>([]);
    private readonly tasksSubject = new BehaviorSubject<SwarmTaskRuntime[]>([]);

    /** Trigger a state refresh from all subjects. */
    private readonly refreshTrigger = new Subject<"all">();

    private eventAbortController: AbortController | null = null;

    constructor(
        streamPool: CoreEventStreamPoolService,
        private readonly dockerService: DockerService,
        private readonly swarmClusterService: SwarmClusterService,
        private readonly swarmFleetService: SwarmFleetService,
        private readonly inventoryRepository: ClusterNodeInventoryRepository,
    ) {
        super(streamPool);
    }

    async onModuleInit(): Promise<void> {
        // Initial state load
        await this.refreshAllState();

        // Start listening to Docker events
        this.startDockerEventStream();

        // Listen to refresh triggers (after mutations)
        this.refreshTrigger.subscribe(() => {
            void this.refreshAllState();
        });
    }

    onModuleDestroy(): void {
        this.eventAbortController?.abort();
    }

    /** Called by controllers after mutations to trigger a state refresh. */
    notifyMutation(): void {
        this.refreshTrigger.next("all");
    }

    // ─── Public observables (consumed by controllers) ────────────────────

    /** Snapshot stream: current state + updates on swarm events. */
    observeSnapshot(): Observable<ClusterSnapshot> {
        return this.observeDomainPooledStream("snapshot", () =>
            this.snapshotSubject.pipe(filter((s): s is ClusterSnapshot => s !== null)),
        );
    }

    /** Nodes inventory stream. */
    observeNodes(includeDown: boolean): Observable<ClusterNodeInventoryRow[]> {
        return this.observeDomainPooledStream<ClusterNodeInventoryRow[]>(
            `nodes:${includeDown}`,
            () => this.nodesSubject.pipe(
                map((rows) => {
                    const typed = rows as ClusterNodeInventoryRow[];
                    return includeDown
                        ? typed
                        : typed.filter((r) => r.state === "active");
                }),
            ) as Observable<ClusterNodeInventoryRow[]>,
        );
    }

    /** Master view stream. */
    observeMaster(): Observable<ClusterMasterView> {
        return this.observeDomainPooledStream<ClusterMasterView>(
            "master",
            () => this.masterSubject.pipe(
                filter((m): m is NonNullable<ClusterMasterView> => m !== null),
            ) as Observable<ClusterMasterView>,
        );
    }

    /** Swarm services stream. */
    observeServices(): Observable<SwarmServiceRuntime[]> {
        return this.observeDomainPooledStream<SwarmServiceRuntime[]>(
            "services",
            () => this.servicesSubject.asObservable() as Observable<SwarmServiceRuntime[]>,
        );
    }

    /** Swarm tasks stream. */
    observeTasks(serviceId?: string, nodeId?: string): Observable<SwarmTaskRuntime[]> {
        const key = `tasks:${serviceId ?? "*"}:${nodeId ?? "*"}`;
        return this.observeDomainPooledStream<SwarmTaskRuntime[]>(
            key,
            () => this.tasksSubject.pipe(
                map((tasks) => {
                    let filtered = tasks as SwarmTaskRuntime[];
                    if (serviceId) filtered = filtered.filter((t) => t.serviceId === serviceId);
                    if (nodeId) filtered = filtered.filter((t) => t.nodeId === nodeId);
                    return filtered;
                }),
            ) as Observable<SwarmTaskRuntime[]>,
        );
    }

    // ─── Internal: Docker event stream ───────────────────────────────────

    private startDockerEventStream(): void {
        this.eventAbortController = new AbortController();

        this.dockerEvents$ = from(this.createDockerEventObservable()).pipe(
            mergeMap((obs) => obs),
            share(),
        );

        // Subscribe and dispatch swarm events with reconnection
        this.dockerEvents$?.subscribe({
            next: (event) => this.handleDockerEvent(event),
            error: (err) => {
                this.logger.error(`Docker event stream error: ${err}`);
                // Reconnect after delay
                setTimeout(() => this.startDockerEventStream(), 5_000);
            },
        });

        this.logger.log("Subscribed to Docker engine event stream for cluster events");
    }

    private createDockerEventObservable(): Promise<Observable<DockerRawEvent>> {
        return (async (): Promise<Observable<DockerRawEvent>> => {
            const client = this.dockerService.getDockerClient();
            const eventStream = await (client.getEvents as Function)({
                since: Math.floor(Date.now() / 1000).toString(),
            }) as NodeJS.ReadableStream;

            return new Observable<DockerRawEvent>((subscriber) => {
                const stream = eventStream as unknown as import("stream").Readable;
                let buffer = "";

                const onData = (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (line.trim()) {
                            try {
                                subscriber.next(JSON.parse(line) as DockerRawEvent);
                            } catch {
                                // partial JSON — skip
                            }
                        }
                    }
                };

                stream.on("data", onData);
                stream.on("error", (err: Error) => subscriber.error(err));
                stream.on("end", () => subscriber.complete());

                return () => {
                    stream.removeListener("data", onData);
                    stream.destroy();
                };
            });
        })();
    }

    private handleDockerEvent(event: DockerRawEvent): void {
        const eventType = event.Type;
        if (!eventType || !SWARM_EVENT_TYPES.has(eventType)) {
            return; // Not a swarm-relevant event
        }

        this.logger.debug(
            `Swarm event: ${eventType} ${event.Action ?? "?"} actor=${event.Actor?.ID?.slice(0, 12) ?? "?"}`,
        );

        // Debounce: refresh all state on any swarm event
        // Docker events can fire rapidly during rolling updates
        this.debouncedRefresh();
    }

    private refreshTimer: ReturnType<typeof setTimeout> | null = null;

    private debouncedRefresh(): void {
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.refreshAllState();
        }, 500); // 500ms debounce for rapid event bursts
    }

    // ─── State refresh ───────────────────────────────────────────────────

    private async refreshAllState(): Promise<void> {
        try {            // ── A NON-SWARM NODE HAS NOTHING TO REFRESH ─────────────────────────
            // The plain `dev` profile is entirely compose-managed and never joins
            // or founds a swarm — by design. Calling the swarm fleet APIs there
            // does not return an empty list, it THROWS:
            //
            //   This node is not a swarm manager. Use "docker swarm init" …
            //
            // and because this runs on every Docker event (debounced 500ms) it
            // produced a continuous ERROR stream that buried real failures and
            // made a working compose stack look broken.
            //
            // The node inventory is kept in the LOCAL database, so it is still
            // refreshed — that is the only cluster state a non-swarm node can
            // legitimately have.
            if (!(await this.isSwarmActive())) {
                this.nodesSubject.next(this.readNodes());
                return;
            }

            const [snapshot, services, tasks] = await Promise.allSettled([
                this.swarmClusterService.getLocalClusterSnapshot(),
                this.swarmFleetService.listServices(),
                this.swarmFleetService.listTasks(),
            ]);

            if (snapshot.status === "fulfilled") {
                this.snapshotSubject.next(snapshot.value);
            }

            if (services.status === "fulfilled") {
                this.servicesSubject.next(services.value);
            }

            if (tasks.status === "fulfilled") {
                this.tasksSubject.next(tasks.value);
            }

            // Refresh nodes from inventory (fast, no engine call)
            this.nodesSubject.next(this.readNodes());

            // Derive master from snapshot
            if (snapshot.status === "fulfilled" && snapshot.value.master) {
                this.masterSubject.next({
                    nodeId: snapshot.value.master.nodeId,
                    term: snapshot.value.master.term,
                    electedAt: snapshot.value.master.electedAt,
                    heartbeatAt: snapshot.value.master.heartbeatAt,
                    reason: snapshot.value.master.reason,
                    state: "healthy",
                });
            }
        } catch (error: unknown) {
            this.logger.warn(
                `Cluster state refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /**
     * Whether the local engine is an ACTIVE swarm member.
     *
     * Cheap `GET /info` probe, never throws — the same contract as
     * `BaseDockerSupervisorService.isSwarmActive()`. A node that is not a member
     * (plain compose `dev`) has no swarm state to read, and asking for it fails
     * with `This node is not a swarm manager` rather than returning empty.
     */
    private async isSwarmActive(): Promise<boolean> {
        try {
            const info = await this.dockerService.getSwarmInfo();
            return info.LocalNodeState === "active";
        } catch {
            return false;
        }
    }

    /**
     * Decode the node inventory into contract rows.
     *
     * The inventory lives in the LOCAL database, so this is valid on a non-swarm
     * node too — it is the one piece of cluster state a compose-managed dev stack
     * legitimately has.
     */
    private readNodes(): ClusterNodeInventoryRow[] {
        return this.inventoryRepository.list().map((row) =>
            clusterNodeInventoryRowSchema.parse({
                nodeId: row.nodeId,
                hostname: row.hostname,
                swarmRole: row.swarmRole,
                platformRole: row.platformRole,
                isMaster: row.isLeader,
                isIngress: row.isIngress,
                state: row.state,
                lastSeenAt: row.lastSeenAt,
            }),
        );
    }
}
