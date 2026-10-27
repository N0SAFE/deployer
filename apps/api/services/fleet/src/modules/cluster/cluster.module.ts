import { Module } from "@nestjs/common";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";
import { EnvModule } from "@deployer/shared/config/env/env.module";
import { ClusterController } from "./controllers/cluster.controller";
import { ClusterService } from "./services/cluster.service";
import { ClusterSwarmEventsService } from "./events/cluster-swarm-events.service";

/**
 * `EnvModule` IS IMPORTED EXPLICITLY: `ClusterService` injects `EnvService`, so
 * it must be resolvable from THIS module's scope rather than assumed to be
 * registered globally elsewhere.
 */
@Module({
    imports: [SwarmCoreModule, EnvModule],
    controllers: [ClusterController],
    providers: [ClusterService, ClusterSwarmEventsService],
    exports: [ClusterService, ClusterSwarmEventsService],
})
export class ClusterModule {}