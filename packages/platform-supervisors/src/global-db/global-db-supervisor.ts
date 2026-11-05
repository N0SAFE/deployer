/**
 * Supervises the LOCALLY-MANAGED global Postgres.
 *
 * Activation is driven by the persisted `node_config.databaseProvisioning` marker:
 *   - "local": the API spawned its own Postgres during setup; this supervisor owns its desired state
 *     (ensure it runs, report health).
 *   - "external": the operator supplied a database URL. Nothing is managed by this API, so the host does
 *     not register the supervisor and the startup guard / probe path applies instead.
 *   - null: legacy or unknown, treated as external.
 *
 * The desired swarm spec is `buildPostgresSpec` from `@deployer/docker` (setup provisions the very
 * first instance through the same builder), so the supervisor delegates instead of duplicating it.
 */
import { Effect } from 'effect'

import type { SwarmServiceSpecInput } from '@deployer/contracts-entities'
import {
    attachPostgresOverlay,
    buildPostgresSpec,
    makePostgresProvisioner,
    MANAGED_POSTGRES_CONTAINER_NAME,
    MANAGED_POSTGRES_VOLUME_NAME,
    managedPostgresServiceName,
    resolveSupervisorRuntime,
    type DockerEngineShape,
    type DockerError,
    type PostgresIdentity,
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
import { makeSwarmServiceOps } from '../swarm-service/swarm-service-ops'

import { parsePostgresUrl } from './connection'
import { probeExternalDatabase } from './external-probe'
import {
    GLOBAL_DB_SUPERVISOR_ID,
    globalDbProcessInfoSchema,
    globalDbSupervisorPayloadSchema,
    type GlobalDbSupervisorPayload,
} from './schemas'

export type GlobalDbConfig = {
    readonly prefix: () => string | undefined
    /** Credentials and image of the managed database, resolved from the environment. */
    readonly identity: () => PostgresIdentity
    /** The deployment (compose/operator) owns Postgres: the API never supervises it. */
    readonly composeManaged: () => boolean
    readonly runtimeOverride: () => string | undefined
    /** `node_config.databaseProvisioning`. */
    readonly provisioning: () => string | null | undefined
    /** The persisted database DSN; empty when nothing was written yet. */
    readonly databaseUrl: () => string
}

export type GlobalDbDeps = {
    readonly engine: DockerEngineShape
    readonly config: GlobalDbConfig
    readonly logger: { readonly log: (message: string) => void }
}

export type GlobalDbSupervisor = {
    readonly spec: SupervisorSpec<
        typeof globalDbSupervisorPayloadSchema,
        typeof globalDbProcessInfoSchema
    >
}

export function makeGlobalDbSupervisor({
    engine,
    config,
    logger,
}: GlobalDbDeps): GlobalDbSupervisor {
    const ops = makeSwarmServiceOps(engine)
    const provisioner = makePostgresProvisioner(engine)

    const serviceName = () => managedPostgresServiceName(config.prefix())
    const swarmSpec = (): SwarmServiceSpecInput =>
        buildPostgresSpec({
            prefix: config.prefix(),
            identity: config.identity(),
        })
    /** True only when this node manages its own Postgres. */
    const isManagedDatabase = () => config.provisioning() === 'local'

    const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
        // Defensive: unregistered supervisors never run, but the orchestration layer can be asked to
        // ensure all, and an external database must never be touched.
        if (!isManagedDatabase()) return

        const { runtime } = resolveSupervisorRuntime({
            managed: config.composeManaged(),
            rawRuntime: config.runtimeOverride(),
            swarmActive: yield* engine.swarmCluster.isActive(),
            scope: 'mesh-wide',
        })

        if (runtime === 'managed') {
            logger.log(
                'Global-DB managed (compose/operator) — link-only wiring active'
            )
            return
        }
        if (runtime === 'unavailable') {
            // No swarm means nowhere to schedule Postgres. Surface the cause instead of silently running a
            // second, container-based copy.
            return yield* Effect.fail(
                new SupervisedResourceUnavailable({
                    resource: 'Global Postgres',
                    reason: 'requires an active swarm engine or managed (compose/operator) ownership — no legacy container fallback. SwarmBootstrapService should have converged the engine.',
                })
            )
        }

        const swarm = Effect.gen(function* () {
            // Clean the container-era incarnation an older install left behind: swarm owns the database now.
            yield* engine.containers.removeIfExists(
                MANAGED_POSTGRES_CONTAINER_NAME
            )
            const spec = attachPostgresOverlay(swarmSpec(), config.prefix())
            yield* provisioner.ensureOverlay(config.prefix())
            yield* engine.swarmServices.reconcile(spec)
            const service = yield* engine.swarmServices.inspect(spec.name)
            if (!service.ID)
                return yield* Effect.fail(
                    new SupervisedResourceMissing({
                        resource: `Global-DB swarm service '${spec.name}'`,
                    })
                )
        })
        yield* withBackoff('Postgres (swarm) convergence', swarm, {
            maxAttempts: 3,
        })
    })

    /**
     * The locally-managed Postgres SWARM SERVICE + data volume + published port. A service whose inspect
     * fails is reported as absent: the payload records what failed instead of the probe throwing.
     */
    const probeManaged = Effect.gen(function* () {
        const service = yield* ops.serviceHealth(serviceName()).pipe(
            Effect.map((health) => ({
                serviceId: health.id ?? null,
                exists: true as const,
                createdAt: health.createdAt,
                updatedAt: health.updatedAt,
                serviceName: health.name,
                runningTasks: health.runningTasks,
                totalTasks: health.totalTasks,
            })),
            // Absent (404) or the engine is not a manager.
            Effect.orElseSucceed(() => null)
        )
        // Data-volume usage (`Size` may be null until docker has COW stats).
        const inspected = yield* engine.volumes
            .inspect(MANAGED_POSTGRES_VOLUME_NAME)
            .pipe(Effect.orElseSucceed(() => null))
        const volume =
            inspected === null
                ? null
                : {
                      name: MANAGED_POSTGRES_VOLUME_NAME,
                      mountpoint: inspected.Mountpoint,
                      sizeBytes: inspected.UsageData?.Size ?? null,
                  }
        return {
            mode: 'managed' as const,
            service,
            volume,
            publishedPort: swarmSpec().endpointPorts[0]?.publishedPort ?? null,
        }
    })

    const stamp = (startedAt: number) => ({
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
    })

    /** REAL health observation. Managed: service, volume and port measurements. External: `SELECT 1` + the table listing. */
    const probe: Effect.Effect<
        ProbeResult<GlobalDbSupervisorPayload>,
        DockerError
    > = Effect.gen(function* () {
        const startedAt = Date.now()

        if (!isManagedDatabase()) {
            const external = yield* probeExternalDatabase(config.databaseUrl())
            return {
                healthy: external.select1.ok,
                detail: external.select1.ok
                    ? `database reachable (${String(external.tableCount)} tables in "${external.database}")`
                    : 'database unreachable — SELECT 1 failed',
                payload: {
                    ...stamp(startedAt),
                    mode: 'external' as const,
                    ...external,
                },
            }
        }

        const managed = yield* probeManaged
        const runningTasks = managed.service?.runningTasks ?? 0
        const exists = managed.service?.exists === true
        const healthy = exists && runningTasks > 0
        return {
            healthy,
            detail: healthy
                ? `managed Postgres service running (tasks=${String(runningTasks)}, host :${String(managed.publishedPort ?? '?')}, volume ${String(managed.volume?.sizeBytes ?? '?')} B)`
                : exists
                  ? `managed Postgres service exists but has no running task (tasks=${String(runningTasks)})`
                  : 'managed Postgres swarm service missing',
            payload: { ...stamp(startedAt), ...managed },
        }
    })

    const spec: GlobalDbSupervisor['spec'] = {
        id: GLOBAL_DB_SUPERVISOR_ID,
        description:
            'Global Postgres database (locally-managed container or provided URL)',
        payloadSchema: globalDbSupervisorPayloadSchema,
        processInfoSchema: globalDbProcessInfoSchema,
        converge,
        probe,
        degradedPayload: () => ({
            checkedAt: new Date().toISOString(),
            latencyMs: 0,
            mode: 'external',
            select1: { ok: false, latencyMs: null },
            tableCount: 0,
            tables: [],
            database: 'unknown',
        }),
        processInfo: Effect.suspend(() =>
            ops.describeProcess(swarmSpec()).pipe(
                Effect.map((process) => ({
                    process,
                    connection: parsePostgresUrl(config.databaseUrl()),
                }))
            )
        ),
        blocker: ops.blockerUntilSwarm({ managed: false }),
    }

    return { spec }
}
