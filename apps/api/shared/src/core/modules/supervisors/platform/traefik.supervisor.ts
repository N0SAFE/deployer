import { Logger } from '@nestjs/common'
import { Effect } from 'effect'

import type { DockerEngineShape } from '@deployer/docker'
import { platformOverlayForPrefix } from '@deployer/docker'
import { runPromiseUnwrapped } from '@deployer/effect-core'
import { splitManagedEnv } from '@deployer/env'
import {
    NODE_DOORS_SETTING_KEY,
    type DoorRescueRoute,
} from '@deployer/mesh-client'
import {
    makeTraefikSupervisor,
    PLATFORM_INGRESS_SUPERVISOR_ID,
    type TraefikSupervisor,
} from '@deployer/platform-supervisors'

import { EnvService } from '../../../../config/env/env.module'
import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { PlatformConfigService } from '../../platform-ingress/services/platform-config.service'
import { HostnameService } from '../../platform-ingress/services/hostname.service'
import { buildNodeDoors } from '../../platform-ingress/services/ingress-doors'
import {
    deriveIngressProviderToken,
    INGRESS_TOKEN_HEADER,
    requireIngressSecret,
    TRAEFIK_CONFIG_PATH,
} from '../../platform-ingress/services/ingress-provider-token'
import {
    LANE_ENTRYPOINTS,
    TRAEFIK_ACME_RESOLVER,
} from '../../platform-ingress/services/lane-traefik-config'
import {
    PLATFORM_WEB_INTERNAL_PORT,
    platformApiServiceName,
    platformTraefikContainerName,
} from '../../platform-ingress/services/platform-names'
import {
    buildSupervisor,
    type SupervisorEventBusFacade,
    type SupervisorRegistration,
} from '../../supervision/index'

import type { EdgeProviderRegistryShape } from '../../edge/edge-provider.registry'
import type { ClusterSettingsShape } from '../../mesh-node/cluster-settings'
import type {
    IngressLanesServiceShape,
} from '../../platform-ingress/services/ingress-lanes.service'
import type { PlatformConfigServiceShape } from '../../platform-ingress/services/platform-config.service'
import type { PlatformWebTargetServiceShape } from '../../platform-ingress/services/platform-web-target.service'

export { PLATFORM_INGRESS_SUPERVISOR_ID }

export type TraefikSupervisorDeps = {
    readonly engine: DockerEngineShape
    readonly hostnameService: HostnameService
    readonly env: EnvService
    readonly lanes: IngressLanesServiceShape
    readonly settings: ClusterSettingsShape
    readonly webTarget: PlatformWebTargetServiceShape
    readonly platformConfig: PlatformConfigServiceShape
    readonly edges: EdgeProviderRegistryShape
    readonly bus: SupervisorEventBusFacade
    /** The node's platform secret, read synchronously (the supervisor's config callbacks cannot wait); null before it exists. */
    readonly platformSecret: () => string | null
}

/**
 * The ingress supervisor. What it does (the global swarm service, its routes polled from the API, the
 * lanes, the inbound-edge plan, the node doors) is `@deployer/platform-supervisors`; this supplies the
 * engine, the environment, the hostnames, the lanes, the cluster settings and the edge registry, and decides
 * WHETHER to register: not when compose/operator owns the ingress (`MANAGED_TRAEFIK_ENABLED=true`).
 */
export function makeTraefikRegistration(deps: TraefikSupervisorDeps): {
    readonly registration: SupervisorRegistration
    readonly traefik: TraefikSupervisor
} {
    const {
        engine,
        hostnameService,
        env,
        lanes: lanesService,
        settings,
        webTarget,
        platformConfig,
        edges,
        bus,
        platformSecret,
    } = deps
    const logger = new Logger('TraefikSupervisor')
    const prefix = () => env.get('DEPLOYER_PREFIX')
    const apiTarget = () => {
        const explicit = env.get('DEPLOYER_API_TARGET')?.trim()
        return explicit !== undefined && explicit !== ''
            ? explicit
            : platformApiServiceName(prefix())
    }

    /** The console hosts the local door serves directly when Traefik does not answer. */
    const rescueRoutes = async (target: string): Promise<DoorRescueRoute[]> => {
        const routes: DoorRescueRoute[] = [
            {
                host: hostnameService.apiHostname(),
                target,
                port: env.get('API_PORT'),
            },
        ]
        // The web target asks the managed-web flag: the platform config is the one collaborator it yields.
        const web = await runPromiseUnwrapped(
            webTarget
                .resolveWebTarget()
                .pipe(
                    Effect.provideService(PlatformConfigService, platformConfig)
                )
        )
        if (web !== null)
            routes.push({
                host: hostnameService.webHostname(),
                target: web,
                port: PLATFORM_WEB_INTERNAL_PORT,
            })
        return routes
    }

    const isExternallyManaged = () => splitManagedEnv(env).traefik.enabled

    const traefik = makeTraefikSupervisor({
        engine,
        logger,
        config: {
            prefix,
            serviceName: () => platformTraefikContainerName(prefix()),
            image: () => env.get('DEPLOYER_TRAEFIK_IMAGE'),
            apiTarget,
            apiPort: () => env.get('API_PORT'),
            configPath: TRAEFIK_CONFIG_PATH,
            apiHostname: () => hostnameService.apiHostname(),
            apiOrigin: () => hostnameService.apiOrigin(),
            webOrigin: () => hostnameService.webOrigin(),
            providerToken: () => ({
                header: INGRESS_TOKEN_HEADER,
                value: deriveIngressProviderToken(
                    requireIngressSecret(platformSecret())
                ),
            }),
            acmeEmail: () => env.get('DEPLOYER_TRAEFIK_ACME_EMAIL'),
            entrypoints: LANE_ENTRYPOINTS,
            acmeResolver: TRAEFIK_ACME_RESOLVER,
            externallyManaged: isExternallyManaged,
            runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
            selfHostname: () => process.env.HOSTNAME,
            lanes: lanesService
                .getLanes()
                .pipe(Effect.provideService(ClusterSettings, settings)),
            edgePlan: (lanes) => edges.ingressPlan(lanes),
            publishNodeDoors: ({ lanes, traefikService }) =>
                Effect.gen(function* () {
                    const namePrefix = prefix()
                    const doors = buildNodeDoors({
                        lanes,
                        namePrefix:
                            namePrefix === ''
                                ? 'deployer'
                                : `deployer-${namePrefix}`,
                        network: platformOverlayForPrefix(namePrefix),
                        image: env.get('DEPLOYER_DOOR_IMAGE'),
                        traefikService,
                        rescue: yield* Effect.tryPromise(() =>
                            rescueRoutes(apiTarget())
                        ),
                    })
                    yield* settings.write(NODE_DOORS_SETTING_KEY, doors)
                }),
        },
    })
    const supervisor = buildSupervisor(traefik.spec, bus, 'TraefikSupervisor')
    return {
        traefik,
        registration: {
            supervisor,
            activate: Effect.suspend(() => {
                if (isExternallyManaged()) {
                    logger.log(
                        'Externally-managed Traefik detected (MANAGED_TRAEFIK_ENABLED=true) — supervisor skipped (not registered)'
                    )
                    return Effect.succeed(null)
                }
                return traefik.reload.pipe(
                    Effect.as({
                        background: traefik.background(
                            supervisor.ensureDesiredState
                        ),
                    })
                )
            }),
        },
    }
}
