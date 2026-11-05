/**
 * ONE Postgres instance of the database service, as a supervisor spec.
 *
 * Each instance is a replicated swarm service named `deployer-database-<instance>` with its own data
 * volume, attached to the platform overlay under an ALIAS equal to the instance name, so any service on
 * the private network connects to `postgresql://user:pass@<instance>:5432/db`. REPLICATED, not global:
 * each instance is one logical database, and the alias (not the service name) is the contract the URL
 * depends on.
 */
import { Effect } from 'effect'

import type { SwarmServiceSpecInput } from '@deployer/contracts-entities'
import {
    platformNetworkName,
    resolveSupervisorRuntime,
    type DockerEngineShape,
    type DockerError,
} from '@deployer/docker'
import {
    withBackoff,
    type ProbeResult,
    type SupervisorSpec,
} from '@deployer/supervision'

import {
    SupervisedResourceMissing,
    SupervisedResourceUnavailable,
} from '../errors'
import {
    attachOverlay,
    makeSwarmServiceOps,
    PLATFORM_ROLE_LABEL,
} from '../swarm-service/swarm-service-ops'

import {
    DATABASE_INSTANCE_PREFIX,
    DATABASE_POSTGRES_PORT,
    DATABASE_ROLE,
    DATABASE_SERVICE_SUPERVISOR_ID,
    databaseInstancePayloadSchema,
    databaseInstanceProcessInfoSchema,
    type DatabaseInstancePayload,
} from './schemas'

/** What the deployment says about the database instances (`MANAGED_DATABASE_*`). */
export type DatabaseInstanceSettings = {
    readonly image?: string | undefined
    readonly user?: string | undefined
    readonly password?: string | undefined
    readonly name?: string | undefined
    readonly dataVolumeBase?: string | undefined
}

export type DatabaseInstanceConfig = {
    readonly settings: () => DatabaseInstanceSettings
    readonly prefix: () => string
    readonly runtimeOverride: () => string | undefined
}

export type DatabaseInstance = {
    readonly spec: SupervisorSpec<
        typeof databaseInstancePayloadSchema,
        typeof databaseInstanceProcessInfoSchema
    >
    /** The swarm service name (`deployer-database-<alias>`). */
    readonly serviceName: string
    /** The connection URL with the password masked. */
    readonly urlSafe: string
    /** Removes the instance's service; its data volume persists. */
    readonly remove: Effect.Effect<void, DockerError>
}

/** The instance name reduced to what is safe in a DNS alias. */
export const instanceAlias = (instanceName: string): string =>
    instanceName.replace(/[^a-zA-Z0-9_-]/g, '')

export function makeDatabaseInstance(
    engine: DockerEngineShape,
    config: DatabaseInstanceConfig,
    instanceName: string
): DatabaseInstance {
    const ops = makeSwarmServiceOps(engine)
    const alias = instanceAlias(instanceName)
    const serviceName = `${DATABASE_INSTANCE_PREFIX}-${alias}`

    const settings = () => {
        const managed = config.settings()
        return {
            image: managed.image ?? 'postgres:16-alpine',
            user: managed.user ?? 'deployer',
            password: managed.password ?? 'deployer',
            dbName: managed.name ?? 'deployer',
            dataVolume: `${managed.dataVolumeBase ?? 'deployer-database-data'}-${alias}`,
        }
    }
    const urlSafe = () =>
        `postgresql://${settings().user}:*****@${alias}:${String(DATABASE_POSTGRES_PORT)}/${settings().dbName}`

    const swarmSpec = (): SwarmServiceSpecInput => {
        const { image, user, password, dbName, dataVolume } = settings()
        return {
            name: serviceName,
            image,
            mode: 'replicated',
            replicas: 1,
            env: [
                `POSTGRES_DB=${dbName}`,
                `POSTGRES_USER=${user}`,
                `POSTGRES_PASSWORD=${password}`,
            ],
            command: [],
            args: [],
            labels: {
                [PLATFORM_ROLE_LABEL]: DATABASE_ROLE,
                'deployer.database.instance': instanceName,
            },
            containerLabels: {},
            mounts: [
                {
                    type: 'volume',
                    source: dataVolume,
                    target: '/var/lib/postgresql/data',
                    readOnly: false,
                },
            ],
            placementPreferences: [],
            placementConstraints: [],
            resourcesLimits: {},
            resourcesReservations: {},
            networks: [],
            healthcheck: {
                test: ['CMD-SHELL', `pg_isready -U ${user} -d ${dbName}`],
                intervalMs: 5_000,
                timeoutMs: 5_000,
                retries: 12,
                startPeriodMs: 5_000,
            },
            updateConfig: {
                parallelism: 1,
                delayMs: 0,
                order: 'start-first',
                failureAction: 'rollback',
            },
            // A database must checkpoint on shutdown: SIGKILL corrupts it.
            stopGracePeriodSeconds: 60,
            endpointPorts: [],
            // One task per instance, addressed by its alias: a VIP would only ever forward to that same
            // task, so the load-balancer hop is pure risk.
            endpointMode: 'dnsrr',
        }
    }

    const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
        // Mesh-wide, so swarm-replicated (the instance is reachable by alias).
        const { runtime } = resolveSupervisorRuntime({
            managed: false,
            rawRuntime: config.runtimeOverride(),
            swarmActive: yield* engine.swarmCluster.isActive(),
            scope: 'mesh-wide',
        })
        if (runtime === 'unavailable') {
            return yield* Effect.fail(
                new SupervisedResourceUnavailable({
                    resource: `Database instance '${instanceName}'`,
                    reason: 'requires an active swarm engine (no container fallback); SwarmBootstrapService should have converged the engine',
                })
            )
        }
        // The deployment owns this instance: nothing to converge.
        if (runtime === 'managed') return

        const swarm = Effect.gen(function* () {
            yield* engine.volumes.ensure(settings().dataVolume)
            const overlay = yield* ops.ensureOverlay(
                platformNetworkName(config.prefix())
            )
            // The instance NAME is the DNS contract (`<instance>:5432`).
            const spec = attachOverlay(swarmSpec(), overlay, [
                alias,
                serviceName,
            ])
            yield* engine.swarmServices.reconcile(spec)
            const service = yield* engine.swarmServices.inspect(spec.name)
            if (!service.ID)
                return yield* Effect.fail(
                    new SupervisedResourceMissing({
                        resource: `database instance service '${spec.name}'`,
                    })
                )
        })
        yield* withBackoff(
            `Database instance '${instanceName}' convergence`,
            swarm,
            { maxAttempts: 3 }
        )
    })

    const probe: Effect.Effect<
        ProbeResult<DatabaseInstancePayload>,
        DockerError
    > = Effect.gen(function* () {
        const startedAt = Date.now()
        const health = yield* ops
            .serviceHealth(serviceName)
            .pipe(Effect.orElseSucceed(() => null))
        const running = (health?.runningTasks ?? 0) > 0
        return {
            healthy: running,
            ...(running
                ? {}
                : {
                      detail: `Database instance '${instanceName}' is not running`,
                  }),
            payload: {
                checkedAt: new Date().toISOString(),
                latencyMs: Date.now() - startedAt,
                instance: instanceName,
                service:
                    health === null
                        ? null
                        : {
                              serviceId: health.id ?? null,
                              exists: true,
                              createdAt: null,
                              updatedAt: null,
                              serviceName,
                              runningTasks: health.runningTasks,
                              totalTasks: health.totalTasks,
                          },
                urlSafe: urlSafe(),
            },
        }
    })

    const spec: DatabaseInstance['spec'] = {
        id: `${DATABASE_SERVICE_SUPERVISOR_ID}:${instanceName}`,
        description: 'Database service instance',
        payloadSchema: databaseInstancePayloadSchema,
        processInfoSchema: databaseInstanceProcessInfoSchema,
        converge,
        probe,
        degradedPayload: () => ({
            checkedAt: new Date().toISOString(),
            latencyMs: 0,
            instance: instanceName,
            service: null,
            urlSafe: urlSafe(),
        }),
        processInfo: Effect.suspend(() =>
            ops.describeProcess(swarmSpec()).pipe(
                Effect.map((process) => ({
                    process,
                    name: serviceName,
                    urlSafe: urlSafe(),
                }))
            )
        ),
        blocker: ops.blockerUntilSwarm({ managed: false }),
    }

    return {
        spec,
        serviceName,
        get urlSafe() {
            return urlSafe()
        },
        remove: Effect.suspend(() => engine.swarmServices.remove(serviceName)),
    }
}
