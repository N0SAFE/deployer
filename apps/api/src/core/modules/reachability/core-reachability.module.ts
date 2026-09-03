import { Global, Module } from '@nestjs/common';
import { GlobalDatabaseModule } from '@/core/modules/database/global/global-database.module';
import { EventsModule } from '@/core/modules/events/events.module';
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository';
import { ReachabilityService } from './services/reachability.service';
import { PublicAccessPointService } from './services/public-access-point.service';
import { PublicAccessPointEventService } from './events/public-access-point-event.service';
import { NodeNetworkConfigRepository } from './repositories/node-network-config.repository';

/**
 * CORE: Reachability + Public Access Point.
 *
 * @Global() so ANY module can inject PublicAccessPointService (the first-class
 * public access point) or watch the global event relay without importing this
 * module. The access point is derived from the per-node network config (IP /
 * hostname / DNS-provider tunnel) + a live probe, and broadcast over the core
 * event system as a Zod discriminated-union state.
 */
@Global()
@Module({
  imports: [GlobalDatabaseModule, EventsModule],
  providers: [
    // Local node identity (SQLite node_config) — a second stateless instance
    // is fine; the setup module provides its own.
    NodeConfigRepository,
    NodeNetworkConfigRepository,
    ReachabilityService,
    PublicAccessPointEventService,
    PublicAccessPointService,
  ],
  exports: [
    ReachabilityService,
    PublicAccessPointEventService,
    PublicAccessPointService,
  ],
})
export class CoreReachabilityModule {}
