/**
 * Spawns and supervises the API's managed web app (the dashboard) as one replicated swarm service,
 * when the `managed_web_app.enabled` platform flag is on.
 *
 * Desired state is read from the flag at each convergence (the management console flips it live).
 * When `MANAGED_WEB_APP_EXTERNAL` is set (dev side-by-side) it converges to "removed": an externally
 * running dev web satisfies the architecture without container duplication.
 *
 * The spawned web receives a freshly minted app-instance token as env (the "managed shortcut": no
 * credentials travel through the web container, registration is skipped, heartbeat still applies).
 * Raw tokens are never stored server-side, so a teardown revokes the instance.
 */
import { Effect, Ref, Semaphore } from 'effect'

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

import { probeRoute, type RouteObservation } from './route-probe'
import {
    managedWebProcessInfoSchema,
    managedWebSupervisorPayloadSchema,
    PLATFORM_MANAGED_WEB_ROLE,
    PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
    type ManagedWebSupervisorPayload,
} from './schemas'

/** How long to wait for the ingress to answer the web hostname. */
export const REACHABILITY_TIMEOUT_MS = 3_000
/**
 * The web app's own health route. Not `/`: `/` proves the ROUTER matched, not that the app works,
 * and the dashboard's first paint depends on its server-side data layer. The health route is the
 * app's own verdict (200 = render up and API reachable, 503 = up but API unreachable). Kept in sync
 * with `apps/web/src/app/api/server/health`.
 */
export const HEALTH_PATH = '/api/server/health'
/**
 * Traefik's `web` entrypoint is hardcoded to `:80`, and the swarm service maps the published entry
 * port onto it, so in-network the ingress always answers on `:80` whatever the HOST port is.
 */
export const INGRESS_INTERNAL_PORT = 80

export type ManagedWebConfig = {
    /** The console's swarm service name (`deployer-managed-web[-<prefix>]`). */
    readonly serviceName: () => string
    readonly prefix: () => string
    readonly image: () => string | undefined
    readonly authSecret: () => string | undefined
    readonly apiPort: () => string | number
    /** The ingress's service name on the platform network. */
    readonly ingressHost: () => string
    /** The ingress's in-network port; `INGRESS_INTERNAL_PORT` unless a test serves one elsewhere. */
    readonly ingressPort?: () => number
    /** `SUPERVISOR_RUNTIME`. */
    readonly runtimeOverride: () => string | undefined
    /** `MANAGED_WEB_APP_EXTERNAL`: an externally running web satisfies the platform. */
    readonly external: () => boolean
    readonly hostnames: {
        readonly webHostname: () => string
        readonly webOrigin: () => string
        readonly apiOrigin: () => string
    }
    /** The `managed_web_app.enabled` platform flag. */
    readonly flagEnabled: Effect.Effect<boolean, unknown>
    readonly appInstances: {
        /** Mints an app-instance token; its raw value is available exactly once. */
        readonly mint: (
            label: string
        ) => Effect.Effect<{ readonly appToken: string }, unknown>
        /** Revokes the managed instance, if there is one. */
        readonly revokeManaged: Effect.Effect<void, unknown>
    }
}

export type ManagedWebDeps = {
    readonly engine: DockerEngineShape
    readonly config: ManagedWebConfig
}

export type ManagedWebSupervisor = {
    readonly spec: SupervisorSpec<
        typeof managedWebSupervisorPayloadSchema,
        typeof managedWebProcessInfoSchema
    >
}

export function makeManagedWebSupervisor({
    engine,
    config,
}: ManagedWebDeps): ManagedWebSupervisor {
    const ops = makeSwarmServiceOps(engine)

    const swarmSpec = (): SwarmServiceSpecInput => ({
        name: config.serviceName(),
        image: config.image() ?? 'deployer-web:latest',
        mode: 'replicated',
        replicas: 1,
        env: [],
        command: [],
        args: [],
        labels: {
            [PLATFORM_ROLE_LABEL]: PLATFORM_MANAGED_WEB_ROLE,
            'deployer.platform.web-hostname': config.hostnames.webHostname(),
        },
        containerLabels: {},
        mounts: [],
        placementPreferences: [],
        placementConstraints: [],
        resourcesLimits: {},
        resourcesReservations: {},
        networks: [],
        capabilitiesAdd: [],
        healthcheck: null,
        updateConfig: {
            parallelism: 1,
            delayMs: 0,
            order: 'start-first',
            failureAction: 'rollback',
        },
        stopGracePeriodSeconds: 10,
        endpointPorts: [],
        // One task addressed by DNS name: `dnsrr` keeps consumers off the VIP.
        endpointMode: 'dnsrr',
    })

    /**
     * The app-instance token, minted ONCE per process.
     *
     * Minting creates a new instance row and returns the raw token exactly once, so minting inside a
     * convergence broke the idempotency the platform relies on: a full reconcile sweep re-runs every
     * supervisor each minute, and each fresh token changed the service spec, so the scheduler rolled
     * the task forever (a dashboard that restarts every minute, plus an unbounded pile of orphaned
     * rows). The same token yields the same spec, so a sweep on a correct service is a real no-op.
     * Only a success is kept: a failed mint is tried again next pass.
     */
    const token = Ref.makeUnsafe<string | null>(null)
    const mintLock = Semaphore.makeUnsafe(1)
    const instanceToken: Effect.Effect<string, unknown> = mintLock.withPermits(
        1
    )(
        Effect.gen(function* () {
            const existing = yield* Ref.get(token)
            if (existing !== null) return existing
            const minted = yield* config.appInstances.mint(
                `managed-web-${config.prefix() || 'default'}`
            )
            yield* Ref.set(token, minted.appToken)
            return minted.appToken
        })
    )

    /**
     * The API's PRIVATE address, for the web app's server-side calls. Not the public origin: the
     * public hostname does not resolve inside a container at all, so every server-side call
     * (health included) failed while the API was perfectly reachable on the overlay.
     */
    const apiInternalUrl = (): string => {
        const prefix = config.prefix()
        return `http://${prefix === '' ? 'deployer-api' : `deployer-api-${prefix}`}:${String(config.apiPort())}`
    }

    /**
     * The env the console needs to boot. A swarm task inherits NOTHING from the compose project, and
     * the web's env schema refuses to start without all of these (a crash-loop with no running task and
     * no hint of the missing variable). `AUTH_SECRET` and `BETTER_AUTH_SECRET` must be EQUAL: the
     * schema refines on it, and sessions are signed with one value on both sides.
     */
    const webEnv: Effect.Effect<string[], unknown> = Effect.gen(function* () {
        const appToken = yield* instanceToken
        // The fallback mirrors compose's own literal, so a deployment that never set `AUTH_SECRET`
        // behaves as it did under compose; production refuses to boot without a real one.
        const authSecret = config.authSecret() ?? 'fallback-auth-secret'
        return [
            `API_URL=${apiInternalUrl()}`,
            `NEXT_PUBLIC_API_URL=${config.hostnames.apiOrigin()}`,
            `NEXT_PUBLIC_APP_URL=${config.hostnames.webOrigin()}`,
            `AUTH_SECRET=${authSecret}`,
            `BETTER_AUTH_SECRET=${authSecret}`,
            // The name the web app READS; any other name silently fails its boot-time registration.
            `APP_INSTANCE_TOKEN=${appToken}`,
        ]
    })

    /** Flag + external marker decide whether the console should exist. */
    const desiredEnabled: Effect.Effect<boolean, unknown> = Effect.suspend(
        () => (config.external() ? Effect.succeed(false) : config.flagEnabled)
    )

    const network = () => platformNetworkName(config.prefix())

    /** Runtime: mesh-wide, so swarm-replicated (one console for the platform). */
    const effectiveRuntime = (swarmActive: boolean) =>
        resolveSupervisorRuntime({
            managed: false,
            rawRuntime: config.runtimeOverride(),
            swarmActive,
            scope: 'mesh-wide',
        }).runtime

    /** Removes the console when the flag turns off; teardown kills trust immediately. */
    const removeManagedWeb: Effect.Effect<void, unknown> = Effect.suspend(() =>
        engine.swarmServices
            .remove(config.serviceName())
            .pipe(Effect.andThen(config.appInstances.revokeManaged))
    )

    const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
        if (!(yield* desiredEnabled)) return yield* removeManagedWeb

        const runtime = effectiveRuntime(yield* engine.swarmCluster.isActive())
        // The deployment owns the console: nothing to converge.
        if (runtime === 'managed') return
        if (runtime === 'unavailable') {
            return yield* Effect.fail(
                new SupervisedResourceUnavailable({
                    resource: 'Managed web console',
                    reason: 'requires an active swarm engine (no container fallback); SwarmBootstrapService should have converged the engine',
                })
            )
        }

        const swarm = Effect.gen(function* () {
            const overlay = yield* ops.ensureOverlay(network())
            const spec = attachOverlay(
                { ...swarmSpec(), env: yield* webEnv },
                overlay,
                [config.serviceName()]
            )
            yield* engine.swarmServices.reconcile(spec)
            const created = yield* engine.swarmServices
                .inspect(spec.name)
                .pipe(Effect.orElseSucceed(() => null))
            if (!created?.ID)
                return yield* Effect.fail(
                    new SupervisedResourceMissing({
                        resource: `managed web swarm service '${spec.name}'`,
                    })
                )
        })
        yield* withBackoff('Managed web (swarm) convergence', swarm, {
            maxAttempts: 3,
        })
    })

    /**
     * The last routing observation. The probe and the warnings are two halves of one fact ("is the
     * dashboard routed?"); the warning hook receives only the probe result, so the observation is kept
     * here to keep the warning specific.
     */
    const lastRoute = Ref.makeUnsafe<RouteObservation | null>(null)

    const payload = (
        startedAt: number,
        desired: ManagedWebSupervisorPayload['desired'],
        service: ManagedWebSupervisorPayload['service']
    ): ManagedWebSupervisorPayload => ({
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        desired,
        service,
    })

    const liveService = (name: string) =>
        ops.serviceHealth(name).pipe(
            Effect.map((health) => ({
                runningTasks: health.runningTasks,
                snapshot: {
                    serviceId: health.id ?? null,
                    exists: true,
                    createdAt: health.createdAt,
                    updatedAt: health.updatedAt,
                    serviceName: health.name,
                    runningTasks: health.runningTasks,
                    totalTasks: health.totalTasks,
                },
            })),
            // An absent or unreadable service is "missing" to the probe.
            Effect.catch(() => Effect.succeed(null))
        )

    const probe: Effect.Effect<
        ProbeResult<ManagedWebSupervisorPayload>,
        unknown
    > = Effect.gen(function* () {
        const startedAt = Date.now()
        const desired = (yield* desiredEnabled) ? 'enabled' : 'disabled'
        const live = yield* liveService(config.serviceName())

        if (desired === 'disabled') {
            return {
                healthy: true,
                detail: 'managed web disabled by flag',
                payload: payload(startedAt, desired, null),
            }
        }
        if (live === null) {
            return {
                healthy: false,
                detail: 'service missing while flag enabled',
                payload: payload(startedAt, desired, null),
            }
        }
        if (live.runningTasks === 0) {
            return {
                healthy: false,
                detail: 'service has no running task',
                payload: payload(startedAt, desired, live.snapshot),
            }
        }

        // A RUNNING TASK IS NOT A SERVED SURFACE. The task check proves the container is up, not that
        // `web.<host>` is ROUTED (a node once reported the dashboard healthy while it was a 404). So the
        // route is checked too, but a missing route is a WARNING, not unhealthy: the route can only be
        // published once the handover runs, and setup waits for readiness before releasing the entry
        // port, so "no route -> 503 -> port never released -> no route" deadlocked onboarding.
        const observation = yield* probeRoute({
            ingressHost: config.ingressHost(),
            ingressPort: config.ingressPort?.() ?? INGRESS_INTERNAL_PORT,
            hostname: config.hostnames.webHostname(),
            path: HEALTH_PATH,
            timeoutMs: REACHABILITY_TIMEOUT_MS,
        })
        yield* Ref.set(lastRoute, observation)

        return {
            healthy: true,
            detail: `serving ${config.hostnames.webHostname()}`,
            payload: payload(startedAt, desired, live.snapshot),
        }
    })

    const spec: ManagedWebSupervisor['spec'] = {
        id: PLATFORM_MANAGED_WEB_SUPERVISOR_ID,
        description: 'Managed web app container (flag-controlled)',
        payloadSchema: managedWebSupervisorPayloadSchema,
        processInfoSchema: managedWebProcessInfoSchema,
        converge,
        probe,
        degradedPayload: () => payload(Date.now(), 'disabled', null),
        processInfo: Effect.suspend(() =>
            ops.describeProcess(swarmSpec()).pipe(
                Effect.map((process) => ({
                    process,
                    urls: {
                        webUrl: config.hostnames.webOrigin(),
                        apiUrl: config.hostnames.apiOrigin(),
                    },
                }))
            )
        ),
        // Deferred until a swarm exists, like every swarm-only supervisor.
        blocker: ops.blockerUntilSwarm({ managed: false }),
        // A not-yet-published route is a WARNING: `degraded`, not `down`, so readiness stays 200 and
        // setup proceeds to release the entry port, which lets the config refresher publish the route
        // and clears the warning by itself.
        warnings: () => {
            const observation = Ref.getUnsafe(lastRoute)
            return observation === null || observation.routed
                ? []
                : [`the dashboard is not routed yet — ${observation.reason}`]
        },
    }

    return { spec }
}
