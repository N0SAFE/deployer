import { describe, expect, it, vi } from "vitest";

import { SetupGateService } from "./setup-gate.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import type { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import type { ClusterOrchestratorService } from "@/modules/cluster/services/cluster-orchestrator.service";
import { OrchestrationStreamService } from "@/modules/progress/services/orchestration-stream.service";
import { makeEnvService } from "@/test-support/env";

/**
 * The gate is the single point that decides whether the API may start, and it is
 * the one place the two apps share state — it WRITES the row the API READS. So
 * the assertions are about persisted DATA, not about the phase transition: a
 * correct-looking gate that forgot to write `databaseUrl` would start an API
 * with nothing to connect to.
 *
 * ── WHY `NodeConfigRepository` IS STUBBED AND THE GATE IS NOT ────────────────
 * The repository is a thin Drizzle wrapper over one table — its own spec covers
 * the SQL, and standing up a migrated SQLite file here would test Drizzle rather
 * than the gate's DECISIONS (which URL wins, what is persisted, whether a
 * restart overwrites). The stub records what the gate wrote, which is exactly
 * the contract the API depends on.
 */
function makeRepository(initial: Record<string, unknown> | null = null) {
  let store: Record<string, unknown> | null = initial;
  return {
    find: vi.fn(() => store),
    upsert: vi.fn((data: Record<string, unknown>) => {
      store = { ...(store ?? {}), ...data };
      return store;
    }),
    /** The persisted row, as the API would read it. */
    _row: () => store,
  };
}

describe("SetupGateService", () => {
  const defaults = {
    nodeId: "11111111-1111-4111-8111-111111111111",
    strategy: "local",
    setupState: "not_started",
    meshUrlsSnapshot: [],
  } as const;

  /**
   * A gate whose repository starts empty (a fresh install).
   *
   * `env` defaults to `SETUP_MODE=prod` so the swarm assertions below describe
   * the profile that actually converges an engine. Plain `dev` is asserted
   * separately — it is the one profile that must NOT touch the engine.
   */
  function makeGate(env: Record<string, string> = { SETUP_MODE: "prod" }) {
    const phases = new SetupPhaseService();
    const repo = makeRepository(null);
    // The cluster is stubbed: the gate's job is to ASK for convergence, and the
    // engine's own spec covers whether that succeeds. What this spec pins down is
    // the ORDER — that the swarm is started before the gate can open.
    const cluster = { start: vi.fn() };
    const envService = makeEnvService(env);
    // Real, not stubbed: it validates the step ids against the contract's enum,
    // so a typo here is a failing test rather than a blank progress view.
    const orchestration = new OrchestrationStreamService(envService);
    const gate = new SetupGateService(
      phases,
      repo as unknown as NodeConfigRepository,
      envService,
      cluster as unknown as ClusterOrchestratorService,
      orchestration,
    );
    return { gate, phases, repo, cluster };
  }

  /** A gate whose repository already holds a row (a restart). */
  function makeRestartGate(row: Record<string, unknown>) {
    const phases = new SetupPhaseService();
    const repo = makeRepository({ ...defaults, ...row });
    const cluster = { start: vi.fn() };
    const envService = makeEnvService({ SETUP_MODE: "prod" });
    const gate = new SetupGateService(
      phases,
      repo as unknown as NodeConfigRepository,
      envService,
      cluster as unknown as ClusterOrchestratorService,
      new OrchestrationStreamService(envService),
    );
    return { gate, phases, repo, cluster };
  }

  describe("opening the gate", () => {
    it("starts the SWARM and does NOT open the gate itself", async () => {
      const { gate, phases, cluster } = makeGate();

      await gate.open(undefined);

      // The swarm must exist before the API can be scheduled onto it — a swarm
      // GLOBAL service cannot be created on an engine that is not a swarm. So
      // `open()` asks for convergence and the CLUSTER PIPELINE publishes
      // `launching` when the engine reports active.
      expect(cluster.start).toHaveBeenCalledTimes(1);
      expect(phases.isReady(), "the gate stays closed until the swarm is active").toBe(false);
      expect(phases.current().phase).toBe("clustering");
    });

    it("OPENS DIRECTLY in dev and never touches the engine", async () => {
      const { gate, phases, cluster } = makeGate({ SETUP_MODE: "dev" });

      await gate.open(undefined);

      // Plain compose dev runs NO swarm: compose owns the API as an ordinary
      // container. Founding a cluster there would be an unrequested and
      // irreversible side effect (a node cannot un-init without destroying Raft
      // state) on an engine that profile never uses.
      expect(cluster.start, "dev must not converge a cluster").not.toHaveBeenCalled();
      // And the gate opens HERE, because there is no swarm step to wait for —
      // compose starts the API as soon as this app reports healthy.
      expect(phases.isReady()).toBe(true);
      expect(phases.current().phase).toBe("launching");
    });

    it("asks for a FOUNDING node when the wizard supplied no join target", async () => {
      const { gate, cluster } = makeGate();

      await gate.open({ strategy: "local" });

      expect(cluster.start).toHaveBeenCalledWith({ kind: "found" });
    });

    it("asks to JOIN only when BOTH a token and addresses were supplied", async () => {
      const { gate, cluster } = makeGate();

      await gate.open({
        strategy: "remote",
        swarm: { joinToken: "SWMTKN-1-abc", joinAddrs: ["10.0.0.1:2377"] },
      });

      expect(cluster.start).toHaveBeenCalledWith({
        kind: "join",
        joinToken: "SWMTKN-1-abc",
        remoteAddrs: ["10.0.0.1:2377"],
      });
    });

    it("falls back to FOUNDING when the join payload is incomplete", async () => {
      const { gate, cluster } = makeGate();

      // A token without addresses (or the reverse) cannot complete a join. Setup
      // founds the engine so the API has a swarm to be scheduled on, and the API
      // finishes the join from the fleet's grant — which is where the real
      // addresses come from anyway.
      await gate.open({ strategy: "remote", swarm: { joinToken: "SWMTKN-1-abc" } });

      expect(cluster.start).toHaveBeenCalledWith({ kind: "found" });
    });

    it("persists an operator-supplied database URL before converging", async () => {
      const { gate, repo } = makeGate();

      await gate.open({ existingDatabaseUrl: "postgresql://u:p@db:5432/deployer" });

      // The gate's promise is "the API will find what it needs": a gate that
      // opened without this row would start an API whose boot has no URL.
      expect(repo._row()?.databaseUrl).toBe("postgresql://u:p@db:5432/deployer");
      // An operator-supplied database is EXTERNALLY managed — recording this
      // stops the API's global-db supervisor from supervising a database it
      // does not own.
      expect(repo._row()?.databaseProvisioning).toBe("external");
    });

    it("falls back to a compose-provided database when the operator gave none", async () => {
      const { gate, repo } = makeGate({
        MANAGED_GLOBAL_DB_URL: "postgresql://m:m@global-db:5432/deployer",
      });

      await gate.open(undefined);

      // The operator chose nothing, but the profile PROVIDED a database. Setup
      // is the only process that knows both, so it is the one that resolves it.
      expect(repo._row()?.databaseUrl).toBe("postgresql://m:m@global-db:5432/deployer");
    });

    it("records `local` provisioning when nothing was provided, so the API provisions", async () => {
      const { gate, repo } = makeGate();

      await gate.open(undefined);

      // `null` URL + `local` is the honest description of "provision one for
      // me" — the API then owns the database and supervises it.
      expect(repo._row()?.databaseUrl).toBeNull();
      expect(repo._row()?.databaseProvisioning).toBe("local");
    });

    it("does NOT mark setup as done — that is the API's call after provisioning", async () => {
      const { gate, repo } = makeGate();

      await gate.open({ existingDatabaseUrl: "postgresql://u:p@db:5432/deployer" });

      // Marking it `setup_done` here would make the API skip migrations, seed
      // and admin creation, and would make a retry skip the wizard on a node
      // whose schema was never built.
      expect(repo._row()?.setupState).toBe("not_started");
    });

    it("treats a blank or non-string URL as absent rather than persisting garbage", async () => {
      const { gate, repo } = makeGate();

      await gate.open({ existingDatabaseUrl: "   " });

      // A malformed URL would surface as a driver error far from the mistake.
      expect(repo._row()?.databaseUrl).toBeNull();
    });

    it("is idempotent: a second open neither re-persists nor re-converges", async () => {
      const { gate, repo, cluster } = makeGate();
      await gate.open({ existingDatabaseUrl: "postgresql://u:p@db:5432/deployer" });

      // Simulate the cluster pipeline reporting success, which is what opens the
      // gate in production.
      gate["phases"].record("launching", "cluster active");
      await gate.open({ existingDatabaseUrl: "postgresql://OTHER@db:5432/deployer" });

      expect(repo._row()?.databaseUrl).toBe("postgresql://u:p@db:5432/deployer");
      expect(cluster.start).toHaveBeenCalledTimes(1);
    });
  });

  describe("the restart path", () => {
    it("converges the swarm from the PERSISTED row, without the wizard", () => {
      const { gate, phases, cluster } = makeRestartGate({
        setupState: "setup_done",
        databaseUrl: "postgresql://u:p@db:5432/deployer",
        databaseProvisioning: "local",
      });

      gate.onApplicationBootstrap();

      // Same flow as a fresh install minus the collecting step. The gate is NOT
      // open yet: the cluster pipeline opens it once the engine is active, which
      // is what stops compose scheduling the API onto a swarm that does not
      // exist.
      expect(cluster.start).toHaveBeenCalledWith({ kind: "found" });
      expect(phases.isReady()).toBe(false);
      expect(phases.current().phase).toBe("clustering");
    });

    it("does NOT re-persist on a restart, so the completed row survives", () => {
      const { gate, repo } = makeRestartGate({
        nodeId: "22222222-2222-4222-8222-222222222222",
        setupState: "setup_done",
        databaseUrl: "postgresql://u:p@db:5432/deployer",
        swarmConfig: { mode: "create" },
      });

      gate.onApplicationBootstrap();

      // Overwriting from an EMPTY payload (a restart passes none) would erase
      // the database URL and the swarm participation the API is about to read.
      expect(repo._row()?.databaseUrl).toBe("postgresql://u:p@db:5432/deployer");
      expect(repo._row()?.nodeId).toBe("22222222-2222-4222-8222-222222222222");
      expect(repo.upsert).not.toHaveBeenCalled();
    });

    it("keeps the gate CLOSED and converges NOTHING when a previous run did not finish", () => {
      const { gate, phases, cluster } = makeRestartGate({
        setupState: "not_started",
        databaseUrl: "postgresql://u:p@db:5432/deployer",
        databaseProvisioning: "external",
      });

      gate.onApplicationBootstrap();

      // A `databaseUrl` alone is an UNPROVISIONED candidate. Skipping the wizard
      // on that basis would leave an empty schema with no surface to fix it — and
      // converging here would auto-found a cluster before the operator has chosen
      // how to join, which is exactly what this ordering exists to prevent.
      expect(cluster.start).not.toHaveBeenCalled();
      expect(phases.isReady()).toBe(false);
      expect(phases.current().phase).toBe("collecting");
    });

    it("keeps the gate closed and converges nothing when there is no config row", () => {
      const phases = new SetupPhaseService();
      const repo = makeRepository(null);
      const cluster = { start: vi.fn() };
      const envService = makeEnvService({ SETUP_MODE: "prod" });
      const gate = new SetupGateService(
        phases,
        repo as unknown as NodeConfigRepository,
        envService,
        cluster as unknown as ClusterOrchestratorService,
        new OrchestrationStreamService(envService),
      );

      gate.onApplicationBootstrap();

      expect(cluster.start).not.toHaveBeenCalled();
      expect(phases.isReady()).toBe(false);
    });
  });
});
