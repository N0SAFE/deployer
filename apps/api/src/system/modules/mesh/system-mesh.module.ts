import { Module, OnModuleInit } from "@nestjs/common";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { SetupModule } from "@/modules/setup/setup.module";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import { setMeshSecretProvider } from "@/core/modules/auth/orpc/middlewares";
import { SystemMeshController } from "./controllers/system-mesh.controller";
import { SystemMeshSseController } from "./controllers/system-mesh-sse.controller";

@Module({
    imports: [MeshCoreModule, SetupModule],
    controllers: [SystemMeshController, SystemMeshSseController],
})
export class SystemMeshModule implements OnModuleInit {
    constructor(private readonly nodeConfigRepository: NodeConfigRepository) {}

    onModuleInit() {
        // Wire the DB-backed mesh secret provider so that
        // requireMesh() / requireInternalMesh() can resolve the
        // shared secret from the local node_config table without
        // depending on the MESH_STREAM_SHARED_SECRET env var.
        setMeshSecretProvider(() => this.nodeConfigRepository.getMeshSharedSecret());
    }
}
