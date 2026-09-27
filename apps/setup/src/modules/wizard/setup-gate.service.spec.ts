import { describe, expect, it, vi } from "vitest";

import { SetupGateService } from "./setup-gate.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import type { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
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

  /** A gate whose repository starts empty (a fresh install). */
  function makeGate(env: Record<string, string> = {}) {
    const phases = new SetupPhaseService();
    const repo = makeRepository(null);
    const gate = new SetupGateService(
      phases,
      repo as unknown as NodeConfigRepository,
      makeEnvService(env),
    );
    return { gate, phases, repo };
  }

  /** A gate whose repository already holds a row (a restart). */
  function makeRestartGate(row: Record<string, unknown>) {
    const phases = new SetupPhaseService();
    const repo = makeRepository({ ...defaults, ...row });
    const gate = new SetupGateService(
      phases,
      repo as unknown as NodeConfigRepository,
      makeEnvService(),
    );
    return { gate, phases, repo };
  }

  describe("opening the gate", () => {
    it("publishes `launching`, which is what compose reads", async () => {
      const { gate, phases } = makeGate();

      await gate.open(undefined);

      expect(phases.current().phase).toBe("launching");
      expect(phases.isReady()).toBe(true);
    });

    it("persists an operator-supplied database URL before opening", async () => {
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

    it("is idempotent: a second open keeps the row and does not re-publish", async () => {
      const { gate, phases, repo } = makeGate();
      await gate.open({ existingDatabaseUrl: "postgresql://u:p@db:5432/deployer" });

      const transitions: string[] = [];
      phases.events$.subscribe((event) => transitions.push(event.to));

      await gate.open({ existingDatabaseUrl: "postgresql://OTHER@db:5432/deployer" });

      expect(repo._row()?.databaseUrl).toBe("postgresql://u:p@db:5432/deployer");
      expect(transitions).toHaveLength(0);
    });
  });

  describe("the restart path", () => {
    it("opens the gate at boot when a previous run completed setup", () => {
      const { gate, phases } = makeRestartGate({
        setupState: "setup_done",
        databaseUrl: "postgresql://u:p@db:5432/deployer",
        databaseProvisioning: "local",
      });

      gate.onApplicationBootstrap();

      // Same flow as a fresh install minus the wizard — the API restarts,
      // provisions the delta, and setup hands over and exits.
      expect(phases.current().phase).toBe("launching");
      expect(phases.isReady()).toBe(true);
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

    it("keeps the gate CLOSED when a previous run did not finish", () => {
      const { gate, phases } = makeRestartGate({
        setupState: "not_started",
        databaseUrl: "postgresql://u:p@db:5432/deployer",
        databaseProvisioning: "external",
      });

      gate.onApplicationBootstrap();

      // A `databaseUrl` alone is an UNPROVISIONED candidate. Skipping the wizard
      // on that basis would leave an empty schema with no surface to fix it.
      expect(phases.current().phase).toBe("awaiting");
      expect(phases.isReady()).toBe(false);
    });

    it("keeps the gate closed when there is no config row at all", () => {
      const phases = new SetupPhaseService();
      const repo = makeRepository(null);
      const gate = new SetupGateService(
        phases,
        repo as unknown as NodeConfigRepository,
        makeEnvService(),
      );

      gate.onApplicationBootstrap();

      expect(phases.isReady()).toBe(false);
    });
  });
});
