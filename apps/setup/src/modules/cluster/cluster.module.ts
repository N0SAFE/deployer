import { Module } from "@nestjs/common";
import { DockerModule } from "@repo/nest-docker/docker.module";
import { NodesModule } from "@repo/nest-nodes";
import { SwarmModule } from "@repo/nest-swarm";

import { localDatabaseRegistration } from "@/config/database/local-database.module";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { SetupHealthModule } from "@/modules/health/setup-health.module";
import { SetupProgressModule } from "@/modules/progress/progress.module";
import { ClusterOrchestratorService } from "./services/cluster-orchestrator.service";
import { SwarmBootstrapService } from "./services/swarm-bootstrap.service";

/**
 * The cluster half of setup: found or join the swarm, then apply the node
 * policy.
 *
 * WHY `forRoot`-CONFIGURED IMPORTS RATHER THAN RE-DECLARED PROVIDERS
 * `@repo/nest-docker`, `@repo/nest-nodes` and `@repo/nest-swarm` each own their
 * wiring through `forRoot`/`forRootAsync`. This module supplies this app's
 * VALUES through those entry points and declares only its own two services.
 * Re-declaring the package providers here would be a second wiring of the same
 * classes — and a missing provider is a runtime DI failure, not a compile
 * error, which is exactly why the packages own it.
 *
 * DEPENDENCY ORDER MATTERS
 * `DockerModule` and `NodesModule` register the engine client and the local
 * SQLite repositories. `SwarmModule` resolves both at construction, so they are
 * imported first. The swarm config is resolved from `EnvService` through
 * `forRootAsync`, so this app's variables never leak into the package.
 */
@Module({
  imports: [
    EnvModule,
    DockerModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: {
          host: env.get("DOCKER_HOST"),
          port: env.get("DOCKER_PORT"),
        },
        // Setup drives the engine (swarm init/join, service creation) but
        // never scans images. The scanner is still part of the package's
        // contract, so every field is satisfied explicitly with the scanning
        // path disabled, rather than inventing an image this app would never
        // run or leaving a field to be resolved at runtime.
        scanner: {
          image: env.get("SCANNER_RUNNER_IMAGE") ?? "unused-by-setup",
          buildContext: undefined,
          idleTimeoutMs: 0,
          autoScanDisabled: true,
        },
      }),
    }),
    // The registration is passed IN (not imported ambiently): the node
    // repositories inject `LocalDatabaseService`, so the connection must be
    // in this module's scope. The app owns the file path and migrations dir —
    // setup shares the API's SQLite file, because setup WRITES the swarm
    // participation decision that the API READS.
    NodesModule.forRoot({ localDatabase: localDatabaseRegistration() }),
    SetupHealthModule,
    // The swarm phase REPORTS on the operator's timeline, so it needs the
    // progress module. It is a leaf dependency (it imports only `EnvModule`),
    // which is what keeps `cluster/` from having to know about the wizard.
    SetupProgressModule,
    SwarmModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        election: {
          // Setup does not run the election loop — it only founds or joins.
          // The values are still required by the contract, so they are passed
          // through unchanged; the API app is what actually elects.
          evalStableMs: env.get("SWARM_ELECTION_EVAL_STABLE_MS") ?? 15_000,
          evalVolatileMs: env.get("SWARM_ELECTION_EVAL_VOLATILE_MS") ?? 5_000,
          cooldownMs: env.get("SWARM_ELECTION_COOLDOWN_MS") ?? 60_000,
          deltaMaster: env.get("SWARM_ELECTION_DELTA_MASTER") ?? 0.25,
          heartbeatTtlMs: env.get("SWARM_HEARTBEAT_TTL_MS") ?? 30_000,
          masterGraceMs: env.get("SWARM_MASTER_GRACE_MS") ?? 15_000,
        },
        // ── ONLY `overlayIp`, AND ONLY BECAUSE IT IS A FALLBACK ────────────
        // The mode / policy / join-token / join-address defaults are gone: this
        // app never converges the engine before setup, and the wizard always
        // writes the full `node_config.swarmConfig`, which `effectiveConfig()`
        // prefers. Supplying them would be dead configuration.
        //
        // `overlayIp` is different in kind — it is not a participation CHOICE but
        // an ADDRESS SOURCE. `SwarmParticipationService.initOptions()` resolves
        // the advertised address as
        //
        //   cfg.advertiseAddr ?? defaults.advertiseAddr ?? defaults.overlayIp
        //
        // and the wizard persists `advertiseAddr: null` whenever the operator
        // leaves that field blank (it is optional on the form). Without this
        // fallback a founding node on a mesh would advertise `127.0.0.1`, which is
        // precisely the multi-address failure `AdvertiseAddr` exists to prevent.
        //
        // So the one value kept is the one the persisted config cannot express.
        participation: {
          overlayIp: env.get("MANAGED_WIREGUARD_IP") ?? null,
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
        join: {
          // Setup founds the cluster, so the advertised address is resolved from
          // what this node actually answers on. `SwarmBootstrapService` uses the
          // same precedence when it calls `ensureCluster`; these candidates serve
          // the grant issuer, which needs to tell OTHER nodes where to dial.
          controlPlaneCandidates: [
            env.get("SWARM_ADVERTISE_ADDR"),
            env.get("MANAGED_WIREGUARD_IP"),
            env.get("APP_URL"),
          ],
          quorumMax: env.get("SWARM_QUORUM_MAX") ?? 3,
        },
      }),
    }),
  ],
  providers: [SwarmBootstrapService, ClusterOrchestratorService],
  // `ClusterOrchestratorService` is exported because the handover REACTS to the
  // cluster result: it subscribes to `stream$` rather than polling a phase,
  // which is what keeps this app event-driven and makes the dependency
  // direction explicit (handover imports cluster, never the reverse).
  exports: [SwarmBootstrapService, ClusterOrchestratorService],
})
export class SetupClusterModule {}
