import {
    DockerEngine,
    PostgresProvisioner,
    type DockerEngineShape,
    type PostgresProvisionerShape,
} from '@deployer/docker'
import { AppLifecycle, type AppLifecycleShape } from '@deployer/lifecycle'
import {
    createModuleContext,
    EffectHost,
    effectHostProvider,
    serviceLifecycle,
    type EffectHostShape,
} from '@deployer/nest-effect'
import {
    NodeConfigRepository,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'
import {
    SupervisorOrchestrator,
    type SupervisorOrchestratorShape,
} from '@deployer/supervision'
import {
    SwarmBootstrap,
    SwarmCluster,
    type SwarmBootstrapShape,
    type SwarmClusterShape,
} from '@deployer/swarm'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { LocalDatabaseModule } from '../database/local/local-database.module'
import { CoreDockerModule } from '../docker/docker.module'
import {
    CoreEventStreamPoolService,
    type CoreEventStreamPoolServiceShape,
} from '../events/base/index'
import { AppLifecycleModule } from '../lifecycle'
import { MeshInitializationModule } from '../mesh/initialization/mesh-initialization.module'
import {
    MeshInitializationService,
    type MeshInitializationServiceShape,
} from '../mesh/initialization/services/mesh-initialization.service'
import {
    makeMeshVersionService,
    MeshVersionService,
} from '../mesh/version/mesh-version.service'
import { NodeStateModule } from '../node-state/node-state.module'
import { CoreReachabilityModule } from '../reachability/core-reachability.module'
import { SupervisorsModule } from '../supervision/index'
import { SwarmCoreModule } from '../swarm/swarm.module'

import {
    InitializationService,
    makeInitializationService,
} from './services/initialization.service'
import {
    LocalInitializationService,
    makeLocalInitializationService,
    type LocalInitializationServiceShape,
} from './services/local-initialization.service'
import {
    RemoteInitializationService,
    type RemoteInitializationServiceShape,
} from './services/remote-initialization.service'
import { SetupEventService } from './services/setup-event.service'

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
export class CoreInitializationModule extends createModuleContext({
    // SwarmCoreModule is SETUP-SAFE (no post-setup resources, no mesh import),
    // so the wizard can create/join the cluster as part of its own flow.
    // Previously this import closed a cycle via MeshCoreModule → SetupModule.
    imports: [
        MeshInitializationModule,
        LocalDatabaseModule,
        CoreDockerModule,
        CoreReachabilityModule,
        SwarmCoreModule,
        NodeStateModule,
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
        {
            provide: LocalInitializationService,
            useFactory: (
                postgresProvisioner: PostgresProvisionerShape,
                dockerEngine: DockerEngineShape,
                env: EnvService,
                nodeConfigRepository: NodeConfigRepositoryShape,
                swarmBootstrap: SwarmBootstrapShape,
                swarmCluster: SwarmClusterShape,
                supervisors: SupervisorOrchestratorShape,
                host: EffectHostShape
            ) =>
                makeLocalInitializationService({
                    postgresProvisioner,
                    dockerEngine,
                    env,
                    nodeConfigRepository,
                    swarmBootstrap,
                    swarmCluster,
                    supervisors,
                    host,
                }),
            inject: [
                PostgresProvisioner,
                DockerEngine,
                EnvService,
                NodeConfigRepository,
                SwarmBootstrap,
                SwarmCluster,
                SupervisorOrchestrator,
                EffectHost,
            ],
        },
        {
            provide: RemoteInitializationService,
            useFactory: (
                nodeConfigRepository: NodeConfigRepositoryShape,
                envService: EnvService,
                swarmBootstrap: SwarmBootstrapShape,
                swarmCluster: SwarmClusterShape,
                host: EffectHostShape
            ) =>
                new RemoteInitializationService.live({
                    nodeConfigRepository,
                    envService,
                    swarmBootstrap,
                    swarmCluster,
                    host,
                }),
            inject: [
                NodeConfigRepository,
                EnvService,
                SwarmBootstrap,
                SwarmCluster,
                EffectHost,
            ],
        },
        {
            provide: InitializationService,
            useFactory: (
                nodeConfigRepository: NodeConfigRepositoryShape,
                localInitializationService: LocalInitializationServiceShape,
                remoteInitializationService: RemoteInitializationServiceShape,
                setupEventService: SetupEventService,
                lifecycle: AppLifecycleShape
            ) =>
                makeInitializationService({
                    nodeConfigRepository,
                    localInitializationService,
                    remoteInitializationService,
                    setupEventService,
                    lifecycle,
                }),
            inject: [
                NodeConfigRepository,
                LocalInitializationService,
                RemoteInitializationService,
                SetupEventService,
                AppLifecycle,
            ],
        },
        serviceLifecycle(InitializationService),
        effectHostProvider(),
        {
            provide: SetupEventService,
            useFactory: (pool?: CoreEventStreamPoolServiceShape) =>
                new SetupEventService(pool),
            inject: [{ token: CoreEventStreamPoolService, optional: true }],
        },
        {
            provide: MeshVersionService,
            useFactory: (mesh: MeshInitializationServiceShape) =>
                makeMeshVersionService(mesh),
            inject: [MeshInitializationService],
        },
    ],
    exports: [
        InitializationService,
        LocalInitializationService,
        RemoteInitializationService,
        SetupEventService,
        MeshVersionService,
    ],
}) {}
