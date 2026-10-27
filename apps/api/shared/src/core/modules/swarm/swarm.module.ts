/**
 * CORE MODULE: Swarm — the API's WIRING of the shared swarm primitives.
 *
 * The package (`@deployer/nest-swarm`) owns the behaviour: init/join, membership,
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
 *
 * `MeshAgentModule` is a different thing (the node's mesh AGENT, below Swarm): it
 * has no dependencies but env, so importing it here cannot create a cycle, and it
 * is what tells Swarm which address to bind (see `meshAddress` below).
 */

import { Module } from "@nestjs/common";
import { SwarmModule } from "@deployer/nest-swarm";
import { splitManagedEnv } from "@deployer/env";
import { NodeStateModule } from "../node-state/node-state.module";
import { EnvModule, EnvService } from "../../../config/env/env.module";
import { MeshAgentModule } from "../mesh-agent/mesh-agent.module";
import { MeshAgentClient } from "../mesh-agent/mesh-agent.client";

/**
 * Whether the DEPLOYMENT owns every platform service (compose / operator).
 *
 * True for the plain `dev` profile, where all of `MANAGED_*_ENABLED` are `true`:
 * no supervisor registers, nothing is scheduled onto a cluster, and founding one
 * would mutate the developer's Docker engine for no purpose.
 *
 * Read from the SAME `splitManagedEnv` source the supervisors use, so this can
 * never disagree with them about who owns what.
 */
function isFullyDeploymentManaged(env: EnvService): boolean {
    const managed = splitManagedEnv(env);
    return (
        managed.traefik.enabled &&
        managed.redis.enabled &&
        managed.localDb.enabled
    );
}

@Module({
    // NodeStateModule supplies NodeConfigRepository + ClusterNodeRepository
    // (pure LOCAL SQLite reads — available before setup and before any global
    // Postgres, which is why the swarm core is setup-safe).
    imports: [
        NodeStateModule,
        SwarmModule.forRootAsync({
            imports: [EnvModule, MeshAgentModule],
            inject: [EnvService, MeshAgentClient],
            useFactory: (env: EnvService, mesh: MeshAgentClient) => ({
                election: {
                    evalStableMs: env.get("SWARM_ELECTION_EVAL_STABLE_MS"),
                    evalVolatileMs: env.get("SWARM_ELECTION_EVAL_VOLATILE_MS"),
                    cooldownMs: env.get("SWARM_ELECTION_COOLDOWN_MS"),
                    deltaMaster: env.get("SWARM_ELECTION_DELTA_MASTER"),
                    heartbeatTtlMs: env.get("SWARM_HEARTBEAT_TTL_MS"),
                    masterGraceMs: env.get("SWARM_MASTER_GRACE_MS"),
                },
                // Joiners are handed the addresses the managers advertise (read
                // from the engine), so there is no address list to configure.
                join: { quorumMax: env.get("SWARM_QUORUM_MAX") },
                participation: {
                    // ── SWARM RIDES THE MESH ────────────────────────────────────
                    // This node's mesh address, from its mesh agent — but only once
                    // the kernel interface carries it: Swarm cannot bind an address
                    // the host does not have. Until then the package binds loopback,
                    // and re-anchors onto the mesh the first time a joiner needs it.
                    meshAddress: async () => {
                        const status = await mesh.status().catch(() => null);
                        return status?.cluster?.interfaceUp === true ? status.cluster.address : null;
                    },
                    // ── DOES THIS DEPLOYMENT RUN A SWARM AT ALL? ───────────────
                    // The plain `dev` profile is entirely compose-managed: every
                    // `MANAGED_*_ENABLED` is `true`, so every supervisor skips
                    // registration and nothing is ever scheduled onto a cluster.
                    // Derived from the SAME `splitManagedEnv` source the supervisors
                    // use, so this can never disagree with them about who owns what.
                    swarmManaged: !isFullyDeploymentManaged(env),
                },
            }),
        }),
    ],
})
export class SwarmCoreModule {}
