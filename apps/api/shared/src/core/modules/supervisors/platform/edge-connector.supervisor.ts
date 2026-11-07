import { Logger } from '@nestjs/common'
import { Effect } from 'effect'

import type { DockerEngineShape } from '@deployer/docker'
import {
    EDGE_CONNECTOR_SUPERVISOR_ID,
    makeEdgeConnectorSupervisor,
} from '@deployer/platform-supervisors'

import { EnvService } from '../../../../config/env/env.module'
import { EdgeProviderRegistry } from '../../edge/edge-provider.registry'
import { ClusterSettings } from '../../mesh-node/cluster-settings'
import { IngressLanesService } from '../../platform-ingress/services/ingress-lanes.service'
import { NodeNetworkConfigRepository } from '../../reachability/repositories/node-network-config.repository'
import { PublicEdgeService } from '../../reachability/services/public-edge.service'
import {
    buildSupervisor,
    type SupervisorEventBusFacade,
    type SupervisorRegistration,
} from '../../supervision/index'

import type {
    EdgeProviderRegistryShape,
} from '../../edge/edge-provider.registry'
import type { ClusterSettingsShape } from '../../mesh-node/cluster-settings'
import type {
    IngressLanesServiceShape,
} from '../../platform-ingress/services/ingress-lanes.service'
import type {
    NodeNetworkConfigRepositoryShape,
} from '../../reachability/repositories/node-network-config.repository'
import type { PublicEdgeServiceShape } from '../../reachability/services/public-edge.service'

export { EDGE_CONNECTOR_SUPERVISOR_ID }

export type EdgeConnectorSupervisorDeps = {
    readonly engine: DockerEngineShape
    readonly env: EnvService
    readonly lanes: IngressLanesServiceShape
    readonly settings: ClusterSettingsShape
    readonly nodeConfigs: NodeNetworkConfigRepositoryShape
    readonly edges: EdgeProviderRegistryShape
    readonly edge: PublicEdgeServiceShape
    readonly bus: SupervisorEventBusFacade
}

/**
 * The supervisor of the public edge's connector. It registers once the connector has been resolved from
 * the provider (the first `reload`); boot does not wait for that, since a slow provider must not hold
 * the app back.
 */
export function makeEdgeConnectorRegistration({
    engine,
    env,
    lanes,
    settings,
    nodeConfigs,
    edges,
    edge,
    bus,
}: EdgeConnectorSupervisorDeps): SupervisorRegistration {
    const logger = new Logger('EdgeConnectorSupervisor')
    const edgeConnector = makeEdgeConnectorSupervisor({
        engine,
        logger,
        config: {
            prefix: () => env.get('DEPLOYER_PREFIX'),
            desired: Effect.gen(function* () {
                const lanesService = yield* IngressLanesService
                const publicEdge = yield* PublicEdgeService
                const current = yield* lanesService.getLanes()
                return yield* publicEdge.connector(current)
            }).pipe(
                Effect.provideService(IngressLanesService, lanes),
                Effect.provideService(PublicEdgeService, edge),
                Effect.provideService(ClusterSettings, settings),
                Effect.provideService(
                    NodeNetworkConfigRepository,
                    nodeConfigs
                ),
                Effect.provideService(EdgeProviderRegistry, edges)
            ),
            routeTarget: () => edge.ingressTarget(),
            runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
        },
    })
    return {
        supervisor: buildSupervisor(
            edgeConnector.spec,
            bus,
            'EdgeConnectorSupervisor'
        ),
        blocking: false,
        activate: edgeConnector.reload.pipe(
            Effect.catch((error: unknown) =>
                Effect.sync(() => {
                    logger.warn(
                        `Edge connector not resolved at boot: ${error instanceof Error ? error.message : String(error)}`
                    )
                })
            ),
            Effect.map(() => {
                logger.log(
                    `Edge connector supervisor registering — runtime=${edgeConnector.runtime()}`
                )
                return {}
            })
        ),
    }
}
