import {
    type InjectionToken,
    type OptionalFactoryDependency,
    type Provider,
} from '@nestjs/common'
import { Context, Effect } from 'effect'

import { DockerEngine, type DockerEngineShape } from '@deployer/docker'
import { nodeDoorFromEnv } from '@deployer/mesh-client'
import { createModuleContext, serviceLifecycle } from '@deployer/nest-effect'
import {
    ClusterNodeRepository,
    NodeConfigRepository,
    type ClusterNodeRepositoryShape,
    type NodeConfigRepositoryShape,
} from '@deployer/node-state'
import {
    makeSwarmServices,
    SwarmBootstrap,
    SwarmCluster,
    SwarmFleet,
    SwarmJoinGrant,
    SwarmLeadership,
    SwarmParticipation,
    type SwarmServices,
    type SwarmServicesOptions,
} from '@deployer/swarm'

import { NodeStateModule } from '@/config/database/node-state.module'
import { DockerModule } from '@/config/docker/docker.module'
import { EnvModule, EnvService } from '@/config/env/env.module'
import { SetupHealthModule } from '@/modules/health/setup-health.module'
import { SetupPhaseService } from '@/modules/health/setup-phase.service'
import { SetupProgressModule } from '@/modules/progress/progress.module'
import { OrchestrationStreamService } from '@/modules/progress/services/orchestration-stream.service'

import {
    ClusterOrchestratorService,
    makeClusterOrchestratorService,
} from './services/cluster-orchestrator.service'
import {
    makeNodeAgentLauncherService,
    NodeAgentLauncherService,
} from './services/node-agent-launcher.service'
import {
    makeSwarmBootstrapService,
    SwarmBootstrapService,
} from './services/swarm-bootstrap.service'

const SWARM_SERVICES = Symbol('SWARM_SERVICES')

/**
 * The swarm services' process-lifetime work, declared as a lifecycle in the shape: the boot convergence (a no-op
 * here: setup founds the cluster from its own flow) runs in `onModuleInit`, and the election loop is `run`, which the
 * runner forks after `onModuleInit` and interrupts on shutdown.
 */
export interface SwarmLifecycleShape {
    readonly onModuleInit: () => Effect.Effect<void, unknown>
    readonly run: () => Effect.Effect<void, unknown>
}

export class SwarmLifecycle extends Context.Service<
    SwarmLifecycle,
    SwarmLifecycleShape
>()('setup/SwarmLifecycle') {}

/** Provides each swarm Effect service under its own tag, all built once over one engine and one repository set. */
const swarmProviders = (config: {
    inject: (InjectionToken | OptionalFactoryDependency)[]
    options: (...deps: never[]) => SwarmServicesOptions
}): Provider[] => [
    {
        provide: SWARM_SERVICES,
        useFactory: (
            docker: DockerEngineShape,
            nodeConfig: NodeConfigRepositoryShape,
            clusterNode: ClusterNodeRepositoryShape,
            ...deps: never[]
        ) =>
            makeSwarmServices(
                { docker, nodeConfig, clusterNode },
                config.options(...deps)
            ),
        inject: [
            DockerEngine,
            NodeConfigRepository,
            ClusterNodeRepository,
            ...config.inject,
        ],
    },
    {
        provide: SwarmCluster,
        useFactory: (s: SwarmServices) => s.cluster,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmFleet,
        useFactory: (s: SwarmServices) => s.fleet,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmParticipation,
        useFactory: (s: SwarmServices) => s.participation,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmJoinGrant,
        useFactory: (s: SwarmServices) => s.joinGrant,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmBootstrap,
        useFactory: (s: SwarmServices) => s.bootstrap,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmLeadership,
        useFactory: (s: SwarmServices) => s.leadership,
        inject: [SWARM_SERVICES],
    },
    {
        provide: SwarmLifecycle,
        useFactory: (services: SwarmServices): SwarmLifecycleShape => ({
            onModuleInit: () => services.bootstrap.onBoot,
            run: () => services.leadership.run,
        }),
        inject: [SWARM_SERVICES],
    },
    serviceLifecycle(SwarmLifecycle),
]

/**
 * This node's mesh address for the swarm package, once the interface carries it.
 *
 * A plain function rather than an injected service: the package's options are
 * built in a factory, before this module's providers exist.
 */
async function nodeAgentAddress(env: EnvService): Promise<string | null> {
    const status = await nodeDoorFromEnv(env).status()
    return status?.interfaceUp === true ? status.meshAddress : null
}

/**
 * The cluster half of setup: found or join the swarm, then apply the node
 * policy.
 *
 * WHY `forRoot`-CONFIGURED IMPORTS RATHER THAN RE-DECLARED PROVIDERS
 * `@deployer/nest-docker`, `@deployer/nest-nodes` and `@deployer/nest-swarm` each own their
 * wiring through `forRoot`/`forRootAsync`. This module supplies this app's
 * VALUES through those entry points and declares only its own two services.
 * Re-declaring the package providers here would be a second wiring of the same
 * classes — and a missing provider is a runtime DI failure, not a compile
 * error, which is exactly why the packages own it.
 *
 * DEPENDENCY ORDER MATTERS
 * `DockerModule` and `NodeStateModule` provide the engine and the local SQLite
 * repositories. The swarm services resolve both at construction, so they are
 * imported first. The swarm config is resolved from `EnvService`, so this app's
 * variables never leak into the package.
 */
export class SetupClusterModule extends createModuleContext({
    imports: [
        EnvModule,
        DockerModule,
        // The app owns the file path and migrations dir: setup shares the API's
        // SQLite file, because setup WRITES the swarm participation decision that
        // the API READS.
        NodeStateModule,
        SetupHealthModule,
        // The swarm phase REPORTS on the operator's timeline, so it needs the
        // progress module. It is a leaf dependency (it imports only `EnvModule`),
        // which is what keeps `cluster/` from having to know about the wizard.
        SetupProgressModule,
    ],
    providers: [
        ...swarmProviders({
            inject: [EnvService],
            options: (env: EnvService): SwarmServicesOptions => ({
                election: {
                    // Setup does not run the election loop — it only founds or joins.
                    // The values are still required by the contract, so they are passed
                    // through unchanged; the API app is what actually elects.
                    evalStableMs:
                        env.get('SWARM_ELECTION_EVAL_STABLE_MS') ?? 15_000,
                    evalVolatileMs:
                        env.get('SWARM_ELECTION_EVAL_VOLATILE_MS') ?? 5_000,
                    cooldownMs: env.get('SWARM_ELECTION_COOLDOWN_MS') ?? 60_000,
                    deltaMaster: env.get('SWARM_ELECTION_DELTA_MASTER') ?? 0.25,
                    heartbeatTtlMs: env.get('SWARM_HEARTBEAT_TTL_MS') ?? 30_000,
                    masterGraceMs: env.get('SWARM_MASTER_GRACE_MS') ?? 15_000,
                },
                // ── SWARM RIDES THE MESH ─────────────────────────────────────────────
                // The address Swarm binds is this node's mesh address, read from its mesh
                // agent when needed (the agent derives it from its own key). No env key
                // names it; with no mesh yet, the package binds loopback.
                metricsProvider: null,
                eventSink: null,
                participation: {
                    meshAddress: Effect.promise(() => nodeAgentAddress(env)),
                },
                // ── THE ENGINE IS CONVERGED BY THE SETUP FLOW, NOT AT BOOT ────────────
                // Whoever starts an app also decides whether it may touch the engine on
                // startup, and for THIS app the answer is no. `setup` FOUNDS the cluster
                // as part of the flow the operator triggers: converging in
                // `onModuleInit` meant every restart ran `docker swarm init` before
                // anything was asked for — and then converged a SECOND time from the
                // trigger, which is the "swarm is initialised when the setup app starts"
                // behaviour this flag removes.
                //
                // The trigger path is unaffected: `ClusterOrchestratorService` calls
                // `SwarmBootstrapService.bootstrap(...)` directly, so the swarm is still
                // founded while the wizard runs — which is when it must be, because the
                // API is scheduled onto that swarm immediately afterwards.
                convergeOnBoot: false,
                // Joiners are handed the addresses the managers advertise (from the
                // engine) — there is no address list to configure.
                join: { quorumMax: env.get('SWARM_QUORUM_MAX') ?? 3 },
            }),
        }),
        {
            provide: NodeAgentLauncherService,
            useFactory: makeNodeAgentLauncherService,
            inject: [DockerEngine, EnvService],
        },
        {
            provide: SwarmBootstrapService,
            useFactory: makeSwarmBootstrapService,
            inject: [
                SwarmCluster,
                SwarmParticipation,
                NodeAgentLauncherService,
            ],
        },
        {
            provide: ClusterOrchestratorService,
            useFactory: makeClusterOrchestratorService,
            inject: [
                SwarmBootstrapService,
                SetupPhaseService,
                OrchestrationStreamService,
            ],
        },
    ],
    // `ClusterOrchestratorService` is exported because the handover REACTS to the
    // cluster result: it subscribes to `stream$` rather than polling a phase,
    // which is what keeps this app event-driven and makes the dependency
    // direction explicit (handover imports cluster, never the reverse).
    exports: [
        SwarmBootstrapService,
        ClusterOrchestratorService,
        NodeAgentLauncherService,
    ],
}) {}
