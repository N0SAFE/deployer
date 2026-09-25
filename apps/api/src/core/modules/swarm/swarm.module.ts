/**
 * CORE MODULE: Swarm — the API's WIRING of the shared swarm primitives.
 *
 * The package (`@repo/nest-swarm`) owns the behaviour: init/join, membership,
 * participation policy, join grants, fleet read-models, master election. This
 * module owns the CONFIGURATION, resolving this app's environment into the
 * narrow `SwarmModuleOptions` contracts the package declares. That split is why
 * a second Nest app can run the same swarm code from its own variables — the
 * package never reads an env var.
 *
 * WHY `forRootAsync` AND NOT HAND-BOUND TOKENS
 * The package declares the tokens (it declares the SHAPE it needs); binding
 * them by hand in every app duplicated the provider list and failed at RUNTIME
 * (not compile time) when one was missed. `forRoot` keeps the wiring inside the
 * package that owns the services while the VALUES still come from here.
 *
 * DEPENDENCIES THE APP REGISTERS FIRST
 * `CoreDockerModule` (`@Global`) supplies `DockerService`; `NodeStateModule`
 * (`@Global`) supplies the node repositories, which read LOCAL SQLite — a file
 * that exists from the first millisecond, which is what keeps this module
 * setup-safe.
 *
 * It deliberately does NOT import the mesh module. The only thing the swarm
 * tree ever needed from mesh was `SystemMeshConfigService`, whose sole consumer
 * is `GlobalClusterNodesRepository` — which needs the GLOBAL POSTGRES and so
 * lives in `SwarmInventoryModule`, loaded after setup. Removing that edge is
 * what broke the former cycle:
 *
 *     MeshCoreModule → SetupModule → CoreInitializationModule → SwarmCoreModule
 *                                                              → MeshCoreModule
 */

import { Module } from "@nestjs/common";
import { SwarmModule } from "@repo/nest-swarm";
import { NodeStateModule } from "@/core/modules/node-state/node-state.module";
import { EnvModule, EnvService } from "@/config/env/env.module";

@Module({
    // NodeStateModule supplies NodeConfigRepository + ClusterNodeRepository
    // (pure LOCAL SQLite reads — available before setup and before any global
    // Postgres, which is why the swarm core is setup-safe).
    imports: [
        NodeStateModule,
        SwarmModule.forRootAsync({
            imports: [EnvModule],
            inject: [EnvService],
            useFactory: (env: EnvService) => ({
                election: {
                    evalStableMs: env.get("SWARM_ELECTION_EVAL_STABLE_MS"),
                    evalVolatileMs: env.get("SWARM_ELECTION_EVAL_VOLATILE_MS"),
                    cooldownMs: env.get("SWARM_ELECTION_COOLDOWN_MS"),
                    deltaMaster: env.get("SWARM_ELECTION_DELTA_MASTER"),
                    heartbeatTtlMs: env.get("SWARM_HEARTBEAT_TTL_MS"),
                    masterGraceMs: env.get("SWARM_MASTER_GRACE_MS"),
                },
                join: {
                    // Ordered: an explicit swarm address wins, then the WireGuard
                    // overlay IP, then the node's own public URL. The package
                    // tries them in order and does not care which source
                    // produced them — which source this app trusts is OUR
                    // decision, so it is made here.
                    controlPlaneCandidates: [
                        env.get("SWARM_ADVERTISE_ADDR"),
                        env.get("MANAGED_WIREGUARD_IP"),
                        env.get("APP_URL"),
                    ],
                    quorumMax: env.get("SWARM_QUORUM_MAX"),
                },
                // First-run defaults, consulted ONLY until the wizard persists a
                // choice in `node_config.swarmConfig` — which then wins.
                participation: {
                    mode: env.get("SWARM_MODE"),
                    policy: env.get("SWARM_POLICY"),
                    advertiseAddr: env.get("SWARM_ADVERTISE_ADDR") ?? null,
                    joinToken: env.get("SWARM_JOIN_TOKEN") ?? null,
                    joinAddrs: env.get("SWARM_JOIN_ADDRS")?.split(",") ?? [],
                    overlayIp: env.get("MANAGED_WIREGUARD_IP") ?? null,
                },
            }),
        }),
    ],
})
export class SwarmCoreModule {}
