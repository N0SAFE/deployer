import { Module } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { SystemMeshController } from "./controllers/system-mesh.controller";
import { SystemMeshSseController } from "./controllers/system-mesh-sse.controller";

@Module({
    imports: [MeshCoreModule],
    controllers: [SystemMeshController, SystemMeshSseController],
})
export class SystemMeshModule {}
