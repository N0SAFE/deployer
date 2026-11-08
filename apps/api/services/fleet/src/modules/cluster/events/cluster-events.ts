import { Context, Effect, Exit, Stream } from 'effect'
import { BehaviorSubject, type Observable, filter, map } from 'rxjs'

import type {
    ClusterSnapshot,
    SwarmServiceRuntime,
    SwarmTaskRuntime,
} from '@deployer/contracts-entities'
import type { DockerEngineShape } from '@deployer/docker'
import {
    clusterNodeInventoryRowSchema,
    type ClusterMasterView,
    type ClusterNodeInventoryRow,
} from '@deployer/fleet-contracts'
import type { ServiceLifecycleShape } from '@deployer/nest-effect'
import type { ClusterNodeInventoryRepositoryShape } from '@deployer/node-state'
import type { CoreEventStreamPoolServiceShape } from '@deployer/shared/core/modules/events/base/index'
import type { SwarmClusterShape, SwarmFleetShape } from '@deployer/swarm'

/** Docker engine event types relevant to swarm cluster state. */
const SWARM_EVENT_TYPES = new Set(['node', 'service', 'task'])

/** The key prefix of this hub's pooled streams, so another domain's stream with the same name cannot collide. */
const STREAM_DOMAIN = 'cluster-swarm'

/** Events that arrive in a burst (a rolling update) cause one refresh, this long after the first of them. */
const REFRESH_WINDOW = '500 millis'

/** How long to wait before looking at the engine's event stream again, after it ended or failed. */
const RECONNECT_DELAY = '5 seconds'

/**
 * The cluster page's live state, as streams.
 *
 * It subscribes to Docker's own event stream (not a poll) and keeps the swarm's snapshot, nodes, master, services and tasks
 * current. Every subscriber gets the current state at once and then the changes: the streaming surface stays RxJS, produced
 * here by an Effect service whose lifetime (the first load, the event subscription, its reconnection) is declared in its
 * shape and run by the lifecycle runner.
 */
export type ClusterEventsShape = ServiceLifecycleShape & {
    /** The snapshot now, and again on every swarm event. */
    readonly observeSnapshot: () => Observable<ClusterSnapshot>
    /** The node inventory (every node, or only the active ones). */
    readonly observeNodes: (includeDown: boolean) => Observable<ClusterNodeInventoryRow[]>
    /** The platform master: the node the mesh elected, with its term. */
    readonly observeMaster: () => Observable<ClusterMasterView>
    readonly observeServices: () => Observable<SwarmServiceRuntime[]>
    /** Tasks, optionally narrowed to one service and/or one node. */
    readonly observeTasks: (serviceId?: string, nodeId?: string) => Observable<SwarmTaskRuntime[]>
}

export type ClusterEventsDeps = {
    readonly docker: DockerEngineShape
    readonly cluster: SwarmClusterShape
    readonly fleet: SwarmFleetShape
    readonly inventory: ClusterNodeInventoryRepositoryShape
    readonly pool: CoreEventStreamPoolServiceShape
}

const describe = (error: unknown): string =>
    error instanceof Error ? error.message : String(error)

/**
 * The cluster page's live state.
 *
 * Stateful on purpose: the subjects ARE the current state every subscriber replays, so the collaborators are constructor
 * arguments (the module passes them) and the lifecycle members cannot ask the Effect context for them.
 */
export class ClusterEvents extends Context.Service<ClusterEvents, ClusterEventsShape>()(
    'fleet/ClusterEvents'
) {
    static readonly live = class ClusterEventsImpl implements ClusterEventsShape {
        private readonly snapshotSubject = new BehaviorSubject<ClusterSnapshot | null>(null)
        private readonly nodesSubject = new BehaviorSubject<ClusterNodeInventoryRow[]>([])
        private readonly masterSubject = new BehaviorSubject<ClusterMasterView>(null)
        private readonly servicesSubject = new BehaviorSubject<SwarmServiceRuntime[]>([])
        private readonly tasksSubject = new BehaviorSubject<SwarmTaskRuntime[]>([])

        constructor(private readonly deps: ClusterEventsDeps) {}

        private pooled<T>(key: string, factory: () => Observable<T>): Observable<T> {
            return this.deps.pool.observePooledStream(`${STREAM_DOMAIN}:${key}`, factory, {
                onError: describe,
            })
        }

        /**
         * The node inventory, decoded into contract rows. It lives in the LOCAL database, so it is valid on a non-swarm node
         * too: it is the one piece of cluster state a compose-managed dev stack legitimately has.
         */
        private readNodes() {
            return this.deps.inventory.list().pipe(
                Effect.map((rows) =>
                    rows.map((row) =>
                        clusterNodeInventoryRowSchema.parse({
                            nodeId: row.nodeId,
                            hostname: row.hostname,
                            swarmRole: row.swarmRole,
                            platformRole: row.platformRole,
                            isMaster: row.isLeader,
                            isIngress: row.isIngress,
                            state: row.state,
                            lastSeenAt: row.lastSeenAt,
                        })
                    )
                )
            )
        }

        /**
         * Loads every stream's state. A failure is logged and the previous state stays: a half-failed refresh must not blank
         * the page.
         *
         * A NON-SWARM node has nothing to refresh. The plain dev profile is compose-managed and never joins a swarm; the
         * swarm fleet calls THROW there ("This node is not a swarm manager") rather than returning empty, and because this
         * runs on every Docker event that was a continuous error stream that buried real failures. So only the inventory is
         * refreshed.
         */
        private refreshAll(): Effect.Effect<void> {
            const { docker, cluster, fleet } = this.deps
            const subjects = {
                snapshot: this.snapshotSubject,
                nodes: this.nodesSubject,
                master: this.masterSubject,
                services: this.servicesSubject,
                tasks: this.tasksSubject,
            }
            const readNodes = this.readNodes()
            return Effect.gen(function* () {
                if (!(yield* docker.swarmCluster.isActive())) {
                    subjects.nodes.next(yield* readNodes)
                    return
                }

                // Each read settles on its own: one that fails does not stop the others from updating their stream.
                const [snapshot, services, tasks] = yield* Effect.all(
                    [
                        Effect.exit(cluster.getLocalClusterSnapshot()),
                        Effect.exit(fleet.listServices()),
                        Effect.exit(fleet.listTasks()),
                    ],
                    { concurrency: 'unbounded' }
                )
                if (Exit.isSuccess(snapshot)) subjects.snapshot.next(snapshot.value)
                if (Exit.isSuccess(services)) subjects.services.next(services.value)
                if (Exit.isSuccess(tasks)) subjects.tasks.next(tasks.value)

                subjects.nodes.next(yield* readNodes)

                // The master is derived from the snapshot.
                if (Exit.isSuccess(snapshot) && snapshot.value.master) {
                    subjects.master.next({
                        nodeId: snapshot.value.master.nodeId,
                        term: snapshot.value.master.term,
                        electedAt: snapshot.value.master.electedAt,
                        heartbeatAt: snapshot.value.master.heartbeatAt,
                        reason: snapshot.value.master.reason,
                        state: 'healthy',
                    })
                }
            }).pipe(
                Effect.catchCause((cause) =>
                    Effect.logWarning(`Cluster state refresh failed: ${String(cause)}`)
                )
            )
        }

        /** One subscription to the engine's events: a refresh per burst of swarm events, until the stream ends or fails. */
        private watch(): Effect.Effect<void, unknown> {
            const { docker } = this.deps
            const refresh = this.refreshAll()
            return Effect.clockWith((clock) =>
                Effect.succeed(Math.floor(clock.currentTimeMillisUnsafe() / 1000))
            ).pipe(
                Effect.flatMap((since) =>
                    docker.events.stream({ since }).pipe(
                        Stream.filter(
                            (event) => event.Type !== undefined && SWARM_EVENT_TYPES.has(event.Type)
                        ),
                        Stream.tap((event) =>
                            Effect.logDebug(
                                `Swarm event: ${event.Type ?? '?'} ${event.Action ?? '?'} actor=${event.Actor?.ID?.slice(0, 12) ?? '?'}`
                            )
                        ),
                        // One refresh per burst, not per event: rolling updates fire rapidly.
                        Stream.groupedWithin(Number.MAX_SAFE_INTEGER, REFRESH_WINDOW),
                        Stream.runForEach(() => refresh)
                    )
                )
            )
        }

        /** Once, before the app serves: the first state, so a subscriber never waits for the first event. */
        onModuleInit(): Effect.Effect<void> {
            return this.refreshAll()
        }

        /**
         * For the life of the app, interrupted at shutdown (which releases the engine connection): subscribe, and when the
         * stream ends or fails, say so and look again after a pause.
         */
        run(): Effect.Effect<void, unknown> {
            const watch = this.watch()
            return Effect.logInfo('Subscribing to the Docker engine event stream for cluster events').pipe(
                Effect.andThen(
                    Effect.forever(
                        watch.pipe(
                            Effect.catchCause((cause) =>
                                Effect.logError(`Docker event stream ended: ${String(cause)}`)
                            ),
                            Effect.andThen(Effect.sleep(RECONNECT_DELAY))
                        )
                    )
                )
            )
        }

        observeSnapshot(): Observable<ClusterSnapshot> {
            return this.pooled('snapshot', () =>
                this.snapshotSubject.pipe(filter((s): s is ClusterSnapshot => s !== null))
            )
        }

        observeNodes(includeDown: boolean): Observable<ClusterNodeInventoryRow[]> {
            return this.pooled(`nodes:${String(includeDown)}`, () =>
                this.nodesSubject.pipe(
                    map((rows) => (includeDown ? rows : rows.filter((row) => row.state === 'active')))
                )
            )
        }

        observeMaster(): Observable<ClusterMasterView> {
            return this.pooled('master', () =>
                this.masterSubject.pipe(
                    filter((m): m is NonNullable<ClusterMasterView> => m !== null)
                )
            )
        }

        observeServices(): Observable<SwarmServiceRuntime[]> {
            return this.pooled('services', () => this.servicesSubject.asObservable())
        }

        observeTasks(serviceId?: string, nodeId?: string): Observable<SwarmTaskRuntime[]> {
            return this.pooled(`tasks:${serviceId ?? '*'}:${nodeId ?? '*'}`, () =>
                this.tasksSubject.pipe(
                    map((tasks) =>
                        tasks.filter(
                            (task) =>
                                (serviceId === undefined || serviceId === '' || task.serviceId === serviceId) &&
                                (nodeId === undefined || nodeId === '' || task.nodeId === nodeId)
                        )
                    )
                )
            )
        }
    }
}
