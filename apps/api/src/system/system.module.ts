import { Module } from "@nestjs/common";
import { SystemMeshModule } from "./modules/mesh/system-mesh.module";
import { SystemFleetModule } from "./modules/fleet/system-fleet.module";

@Module({
  imports: [SystemMeshModule, SystemFleetModule],
})
export class SystemModule {}
