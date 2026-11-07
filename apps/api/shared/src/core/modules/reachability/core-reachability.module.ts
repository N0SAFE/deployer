import { createGlobalModule } from '@deployer/nest-effect'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { GlobalDatabaseModule } from '../database/global/global-database.module'
import { DatabasePort } from '../database/storage'
import { CoreEdgeModule } from '../edge/edge.module'
import { CoreEgressModule } from '../egress/egress.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '../events/base/index'
import { EventsModule } from '../events/events.module'
import { NodeStateModule } from '../node-state/node-state.module'

import { PublicAccessPointEventService } from './events/public-access-point-event.service'
import { NodeNetworkConfigRepository } from './repositories/node-network-config.repository'
import { PublicAccessPointService } from './services/public-access-point.service'
import { PublicEdgeService } from './services/public-edge.service'
import { ReachabilityService } from './services/reachability.service'

import type { Context } from 'effect'

/**
 * CORE: Reachability + Public Access Point.
 *
 * @Global() so ANY module can inject PublicAccessPointService (the first-class
 * public access point) or watch the global event relay without importing this
 * module. The access point is derived from the per-node network config (IP /
 * hostname / DNS-provider tunnel) + a live probe, and broadcast over the core
 * event system as a Zod discriminated-union state.
 */
export const CoreReachabilityModule = createGlobalModule({
    imports: [
        GlobalDatabaseModule,
        EventsModule,
        NodeStateModule,
        CoreEdgeModule,
        EnvModule,
        CoreEgressModule,
    ],
    providers: [
        // NodeConfigRepository comes from NodeStateModule (the single owner of the
        // local node-state repositories) — redeclaring it here created a SECOND
        // instance and triggered the SC8 duplication guard.
        {
            provide: NodeNetworkConfigRepository,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => new NodeNetworkConfigRepository.live(database),
            inject: [DatabasePort],
        },
        {
            provide: PublicEdgeService,
            useFactory: (env: EnvService) =>
                new PublicEdgeService.live(env.get('DEPLOYER_PREFIX')),
            inject: [EnvService],
        },
        { provide: ReachabilityService, useClass: ReachabilityService.live },
        {
            provide: PublicAccessPointEventService,
            useFactory: (pool?: CoreEventStreamPoolServiceShape) =>
                new PublicAccessPointEventService(pool),
            inject: [{ token: CoreEventStreamPoolService, optional: true }],
        },
        {
            provide: PublicAccessPointService,
            useFactory: (accessPointEvents: PublicAccessPointEventService) =>
                new PublicAccessPointService.live(accessPointEvents),
            inject: [PublicAccessPointEventService],
        },
    ],
    exports: [
        ReachabilityService,
        PublicEdgeService,
        PublicAccessPointEventService,
        PublicAccessPointService,
        // `PublicEdgeService` yields this when it reads the nodes' addresses, so an importer of the
        // edge service needs it in its own context: the requirement gate follows the tag, and a
        // provider that is not exported cannot be resolved from an importing module.
        NodeNetworkConfigRepository,
    ],
})
