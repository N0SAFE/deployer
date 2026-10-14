import { Module } from "@nestjs/common";
import { InitializationService } from "./services/initialization.service";
import { NodeStateModule } from "@/core/modules/node-state/node-state.module";
import { RemoteInitializationService } from "./services/remote-initialization.service";
import { LocalInitializationService } from "./services/local-initialization.service";
import { SetupEventService } from "./services/setup-event.service";
import { MeshInitializationModule } from "@/core/modules/mesh/initialization/mesh-initialization.module";
import { LocalDatabaseModule } from "@repo/nest-database-local/local-database.module";
import { CoreDockerModule } from "../docker/docker.module";
import { CoreReachabilityModule } from "../reachability/core-reachability.module";
import { MeshVersionService } from "../mesh/version/mesh-version.service";
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { AppLifecycleModule } from "@repo/nest-lifecycle";
import { EnvModule, EnvService } from "@/config/env/env.module";

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
    // SwarmCoreModule is SETUP-SAFE (no post-setup resources, no mesh import),
    // so the wizard can create/join the cluster as part of its own flow.
    // Previously this import closed a cycle via MeshCoreModule → SetupModule.
    imports: [MeshInitializationModule, LocalDatabaseModule, CoreDockerModule, CoreReachabilityModule, SwarmCoreModule, NodeStateModule,
		EnvModule,
		// `InitializationService` advances the lifecycle when setup completes —
		// see `emitCompleted`. The lifecycle is what readiness READS, so the
		// module that reports completion must be able to set it.
		AppLifecycleModule,
	],
    providers: [
        LocalInitializationService,
        RemoteInitializationService,
        InitializationService,
        SetupEventService,
        MeshVersionService,
    ],
    exports: [InitializationService, LocalInitializationService, RemoteInitializationService, SetupEventService, MeshVersionService],
})
export class CoreInitializationModule {}