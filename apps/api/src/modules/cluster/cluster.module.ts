import { Module } from "@nestjs/common";
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { ClusterController } from "./controllers/cluster.controller";
import { ClusterService } from "./services/cluster.service";
import { ClusterSwarmEventsService } from "./events/cluster-swarm-events.service";

@Module({
    imports: [SwarmCoreModule],
    controllers: [ClusterController],
    providers: [ClusterService, ClusterSwarmEventsService],
    exports: [ClusterService, ClusterSwarmEventsService],
})
export class ClusterModule {}