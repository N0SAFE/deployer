/**
 * Runs the public edge's CONNECTOR, whatever the edge provider is.
 *
 * A tunnel edge (Cloudflare Tunnel, or any provider that dials out) needs a client process on the
 * cluster that holds the outbound connection and forwards to Traefik's `public` entrypoint. Which
 * image, which credential and how many replicas is the provider's answer (`EdgeProvider.connector()`);
 * running it, keeping it healthy and removing it when the lane changes is this supervisor's, so a new
 * tunnel provider needs no supervisor of its own.
 *
 * WHY `replicated` AND NOT `global`: the opposite choice from the ingress, deliberately. Traefik is
 * global because each node routes for its own doors. A connector has NO ports (it dials out), so
 * nothing about it is node-local, and one per node would only multiply the connections the provider
 * tracks. Spread is a PREFERENCE, so the spec also caps one replica per node: with only the preference,
 * two replicas may land on one node and its loss takes the whole edge.
 *
 * NO PORTS, EVER: the connector is a client. Publishing a port would be the exact inbound surface a
 * tunnel edge exists to avoid, so the spec publishes nothing whatever the provider returns.
 *
 * When there is nothing to run (no public lane, an inbound edge, a tunnel not provisioned yet) it
 * reports `managed` ("nothing of ours to run") and REMOVES any connector left from before: a connector
 * kept after a lane switch keeps serving traffic the operator turned off.
 */
import { Effect, Ref } from 'effect'

import type { SwarmServiceSpecInput } from '@deployer/contracts-entities'
import {
    platformNetworkName,
    resolveSupervisorRuntime,
    type DockerEngineShape,
} from '@deployer/docker'
import {
    withBackoff,
    type ProbeResult,
    type SupervisorSpec,
    type SwarmProcessInfo,
} from '@deployer/supervision'

import { SupervisedResourceNotRunning } from '../errors'
import {
    attachOverlay,
    makeSwarmServiceOps,
    PLATFORM_ROLE_LABEL,
} from '../swarm-service/swarm-service-ops'

import {
    EDGE_CONNECTOR_BASE_NAME,
    EDGE_CONNECTOR_SUPERVISOR_ID,
    edgeConnectorProcessInfoSchema,
    edgeConnectorSupervisorPayloadSchema,
    type EdgeConnectorRuntime,
    type EdgeConnectorSupervisorPayload,
} from './schemas'

/** Ownership marker: cleanup and inspection tooling keys off this label. */
const EDGE_CONNECTOR_ROLE = 'platform-edge-connector'
/** Which provider the running connector belongs to. */
const EDGE_PROVIDER_LABEL = 'deployer.edge.provider'

/** The process the cluster must run for the edge. `env` is `KEY=value`: credentials go there, never in argv (readable via `docker inspect`). */
export type EdgeConnectorProcess = {
    readonly image: string
    readonly env: readonly string[]
    readonly command: readonly string[]
    readonly args: readonly string[]
    readonly replicas: number
}

export type DesiredEdgeConnector = {
    readonly providerId: string
    readonly spec: EdgeConnectorProcess
}

export type EdgeConnectorConfig = {
    readonly prefix: () => string
    /** The connector the active provider wants, or null when the edge needs none. Asked on every pass: the lanes and the provider's state are written by the Ingress page. */
    readonly desired: Effect.Effect<DesiredEdgeConnector | null, unknown>
    /** Where the connector forwards (Traefik's `public` entrypoint). */
    readonly routeTarget: () => string
    readonly runtimeOverride: () => string | undefined
}

export type EdgeConnectorDeps = {
    readonly engine: DockerEngineShape
    readonly config: EdgeConnectorConfig
    readonly logger: { readonly log: (message: string) => void }
}

export type EdgeConnectorSupervisor = {
    readonly spec: SupervisorSpec<
        typeof edgeConnectorSupervisorPayloadSchema,
        typeof edgeConnectorProcessInfoSchema
    >
    /** Resolves the desired connector now. The host primes it before registering, so a running edge does not read as absent on the first probe. */
    readonly reload: Effect.Effect<void, unknown>
    readonly runtime: () => EdgeConnectorRuntime
}

export function makeEdgeConnectorSupervisor({
    engine,
    config,
    logger,
}: EdgeConnectorDeps): EdgeConnectorSupervisor {
    const ops = makeSwarmServiceOps(engine)

    /** The last resolved answer, cached because probes and the spec are synchronous reads of it. */
    const desiredRef = Ref.makeUnsafe<DesiredEdgeConnector | null>(null)
    const desired = () => Ref.getUnsafe(desiredRef)
    const reload: Effect.Effect<void, unknown> = config.desired.pipe(
        Effect.flatMap((next) => Ref.set(desiredRef, next))
    )

    const serviceName = (): string => {
        const prefix = config.prefix()
        return prefix === ''
            ? EDGE_CONNECTOR_BASE_NAME
            : `${EDGE_CONNECTOR_BASE_NAME}-${prefix}`
    }

    const runtime = (): EdgeConnectorRuntime =>
        resolveSupervisorRuntime({
            managed: desired() === null,
            rawRuntime: config.runtimeOverride(),
            swarmActive: true,
            scope: 'mesh-wide',
        }).runtime === 'managed'
            ? 'managed'
            : 'swarm-replicated'

    const swarmSpec = (): SwarmServiceSpecInput => {
        const current = desired()
        return {
            name: serviceName(),
            image: current?.spec.image ?? '',
            mode: 'replicated',
            replicas: current?.spec.replicas ?? 0,
            stopGracePeriodSeconds: 30,
            env: [...(current?.spec.env ?? [])],
            command: [...(current?.spec.command ?? [])],
            args: [...(current?.spec.args ?? [])],
            labels: {
                [PLATFORM_ROLE_LABEL]: EDGE_CONNECTOR_ROLE,
                [EDGE_PROVIDER_LABEL]: current?.providerId ?? '',
                'deployer.managed': 'true',
            },
            containerLabels: {},
            mounts: [],
            // Preference AND hard cap: see the header.
            placementPreferences: [{ spreadDescriptor: 'node.id' }],
            placementMaxReplicasPerNode: 1,
            placementConstraints: [],
            resourcesLimits: {},
            resourcesReservations: {},
            networks: [],
            capabilitiesAdd: [],
            // A connector that loses its provider reconnects on its own; a container healthcheck would only
            // add a restart loop. Health is the provider's reported connections (Ingress page) plus running
            // tasks (here).
            healthcheck: null,
            updateConfig: {
                parallelism: 1,
                delayMs: 0,
                order: 'start-first',
                failureAction: 'rollback',
            },
            endpointPorts: [],
            endpointMode: 'dnsrr',
        }
    }

    const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
        // Re-resolved every sweep: this is how the supervisor learns what the Ingress page wrote.
        yield* reload

        if (desired() === null) {
            const leftover = yield* engine.swarmServices
                .inspect(serviceName())
                .pipe(
                    Effect.as(true),
                    Effect.orElseSucceed(() => false)
                )
            if (leftover) {
                yield* engine.swarmServices.remove(serviceName())
                logger.log(
                    `No tunnel edge any more — connector '${serviceName()}' removed`
                )
            }
            return
        }

        const swarm = Effect.gen(function* () {
            const overlay = yield* ops.ensureOverlay(
                platformNetworkName(config.prefix())
            )
            // The connector resolves Traefik by its overlay alias.
            const spec = attachOverlay(swarmSpec(), overlay, [serviceName()])
            yield* engine.swarmServices.reconcile(spec)
            const tasks = yield* engine.swarmServices
                .listTasks(spec.name)
                .pipe(Effect.orElseSucceed(() => []))
            if (!tasks.some((task) => task.Status.State === 'running')) {
                return yield* Effect.fail(
                    new SupervisedResourceNotRunning({
                        resource: `Edge connector '${spec.name}'`,
                    })
                )
            }
        })
        yield* withBackoff('Edge connector convergence', swarm, {
            maxAttempts: 5,
        })
    })

    const payloadBase = () => ({
        checkedAt: new Date().toISOString(),
        runtime: runtime(),
        provider: desired()?.providerId ?? null,
        routeTarget: config.routeTarget(),
    })

    const probe: Effect.Effect<ProbeResult<EdgeConnectorSupervisorPayload>> =
        Effect.gen(function* () {
            const startedAt = Date.now()
            const base = payloadBase()

            if (base.runtime === 'managed') {
                // NOT a failure: an inbound edge, no public lane, or a tunnel not provisioned yet.
                return {
                    healthy: true,
                    detail: 'No tunnel edge needs a connector.',
                    payload: {
                        ...base,
                        latencyMs: Date.now() - startedAt,
                        service: null,
                        replicas: 0,
                    },
                }
            }

            return yield* ops.serviceHealth(serviceName()).pipe(
                Effect.map(
                    (service): ProbeResult<EdgeConnectorSupervisorPayload> => ({
                        healthy: service.runningTasks > 0,
                        ...(service.runningTasks > 0
                            ? {}
                            : {
                                  detail: `Connector has ${String(service.runningTasks)} running task(s)`,
                              }),
                        payload: {
                            ...base,
                            latencyMs: Date.now() - startedAt,
                            service: {
                                id: service.id ?? '',
                                name: service.name,
                                runningTasks: service.runningTasks,
                                exists: true,
                            },
                            replicas: service.runningTasks,
                        },
                    })
                ),
                Effect.catch((error) =>
                    Effect.succeed<ProbeResult<EdgeConnectorSupervisorPayload>>(
                        {
                            healthy: false,
                            detail: `Edge connector probe failed: ${error instanceof Error ? error.message : String(error)}`,
                            payload: {
                                ...base,
                                latencyMs: Date.now() - startedAt,
                                service: null,
                                replicas: 0,
                            },
                        }
                    )
                )
            )
        })

    const spec: EdgeConnectorSupervisor['spec'] = {
        id: EDGE_CONNECTOR_SUPERVISOR_ID,
        description:
            'Public edge connector (outbound-only: no inbound port, no public IP required)',
        payloadSchema: edgeConnectorSupervisorPayloadSchema,
        processInfoSchema: edgeConnectorProcessInfoSchema,
        converge,
        probe,
        degradedPayload: () => ({
            ...payloadBase(),
            latencyMs: 0,
            service: null,
            replicas: 0,
        }),
        processInfo: Effect.suspend(() => {
            if (runtime() === 'swarm-replicated') {
                return ops.describeProcess(swarmSpec()).pipe(
                    Effect.map((process) => ({
                        process,
                        edge: { provider: desired()?.providerId ?? null },
                    }))
                )
            }
            // Nothing runs: reported as a zero-replica swarm resource so consumers see one shape.
            const nothing: SwarmProcessInfo = {
                kind: 'swarm',
                runtime: 'swarm-replicated',
                desired: {
                    name: serviceName(),
                    image: '',
                    command: [],
                    labels: {},
                    networkName: null,
                    mode: 'replicated',
                    replicas: 0,
                },
                live: {
                    serviceId: null,
                    exists: false,
                    createdAt: null,
                    updatedAt: null,
                    serviceName: null,
                    runningTasks: null,
                    totalTasks: null,
                },
            }
            return Effect.succeed({
                process: nothing,
                edge: { provider: null },
            })
        }),
        // Nothing of ours to run is never deferred; a connector waits for the swarm like any other.
        blocker: Effect.suspend(() =>
            ops.blockerUntilSwarm({ managed: desired() === null })
        ),
    }

    return { spec, reload, runtime }
}
