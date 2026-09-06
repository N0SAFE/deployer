import { Module } from "@nestjs/common";
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { ClusterController } from "./controllers/cluster.controller";
import { ClusterService } from "./services/cluster.service";

@Module({
    imports: [SwarmCoreModule],
    controllers: [ClusterController],
    providers: [ClusterService],
    exports: [ClusterService],
})
export class ClusterModule {}