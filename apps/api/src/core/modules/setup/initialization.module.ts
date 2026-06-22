import { Module } from "@nestjs/common";
import { InitializationService } from "./services/initialization.service";
import { NodeConfigRepository } from "./repositories/node-config.repository";
import { RemoteInitializationService } from "./services/remote-initialization.service";
import { LocalInitializationService } from "./services/local-initialization.service";
import { SetupEventService } from "./services/setup-event.service";
import { MeshInitializationModule } from "@/core/modules/mesh/initialization/mesh-initialization.module";
import { LocalModule } from "../database/local/local.module";
import { CoreDockerModule } from "../docker/docker.module";
import { CoreReachabilityModule } from "../reachability/core-reachability.module";

/**
 * Global Setup Module
 * 
 * Responsibilities:
 * 1. Checks if database is already configured on startup
 * 2. Provides a setup wizard for new installations
 * 3. Emits a completion signal when database is configured
 * 4. Unblocks dependent modules (DatabaseModule, feature modules)
 * 
 * The InitializationService holds a Subject that other modules wait for
 * when the database is not yet configured.
 */
@Module({
    imports: [MeshInitializationModule, LocalModule, CoreDockerModule, CoreReachabilityModule],
    providers: [
        LocalInitializationService,
        RemoteInitializationService,
        InitializationService,
        SetupEventService,
        NodeConfigRepository,
    ],
    exports: [InitializationService, NodeConfigRepository, LocalInitializationService, RemoteInitializationService, SetupEventService],
})
export class CoreInitializationModule {}