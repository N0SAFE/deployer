import { Module } from "@nestjs/common";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";
import { NodeStateModule } from "@/core/modules/node-state/node-state.module";
import { RemoteInitializationService } from "@/core/modules/setup/services/remote-initialization.service";
import { LocalInitializationService } from "@/core/modules/setup/services/local-initialization.service";
import { SetupEventService } from "@/core/modules/setup/services/setup-event.service";
import { MeshInitializationModule } from "@/core/modules/mesh/initialization/mesh-initialization.module";
import { LocalDatabaseModule } from "@deployer/nest-database-local/local-database.module";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { CoreReachabilityModule } from "@/core/modules/reachability/core-reachability.module";
import { MeshVersionService } from "@/core/modules/mesh/version/mesh-version.service";
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { AppLifecycleModule } from "@deployer/nest-lifecycle";
import { SupervisorsModule } from "@deployer/nest-supervisor-core/supervisors.module";
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
		// `LocalInitializationService` drives a one-shot convergence of the
		// swarm app-wiring supervisor, so the orchestrator that converges it must be
		// resolvable HERE rather than assumed to be registered globally — the same
		// class of dependency that `TraefikIngressConfigService` and
		// `CoreDomainModule` had.
		SupervisorsModule.forRoot(),
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