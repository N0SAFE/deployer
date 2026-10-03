import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";

import { AppLifecyclePhase } from "@repo/nest-lifecycle";

import { ReadinessStateService } from "../services/readiness-state.service";

/**
 * Readiness indicators for `GET /health/ready`.
 *
 * READINESS answers "can this instance serve the product?", which is a
 * different question from liveness ("is the process alive?"). In this platform
 * the API is started by compose BEFORE setup provisions the database, so
 * refusing to boot on a missing database would crash-loop and leave setup with
 * nothing to drive. Instead the process boots, reports `503` here, and turns
 * green once its dependencies exist.
 *
 * EVERY METHOD HERE IS A PURE CACHE READ — no query, no docker call, no probe.
 * The I/O lives in `ReadinessStateService`, which refreshes on EVENTS
 * (lifecycle transitions + supervisor state changes/health snapshots) plus a
 * slow drift-detection cadence. That matters because this endpoint is polled
 * forever (compose every 15s) and previously performed the full I/O cascade on
 * every single request.
 *
 * Each indicator NAMES ITSELF in the Terminus payload when it fails, so the
 * setup app can map a failing component to one actionable toast.
 *
 * Deliberately NOT an indicator: the entry port / ingress. Readiness is a
 * property of this instance's dependencies; whether Traefik holds the port is
 * the ingress supervisor's concern and is already covered by `services`.
 */
@Injectable()
export class ReadinessIndicators {
  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    private readonly state: ReadinessStateService,
  ) {}

  /**
   * The global Postgres, from the lifecycle service.
   *
   * `databaseReachable` is published by the components that own the pool:
   * `DatabaseStartupGuard` (boot probe), `DatabaseFailureTracker` (mid-run
   * failures) and the orchestrator. `null` means the lifecycle has never
   * recorded a verdict — which is exactly the pre-setup state, since there is
   * no `databaseUrl` to record one for.
   */
  database() {
    const indicator = this.healthIndicator.check("database");
    const snapshot = this.state.snapshot();

    if (snapshot.databaseReachable === null) {
      return indicator.down({ reason: "no database configured yet (setup has not provisioned it)" });
    }
    if (!snapshot.databaseReachable) {
      return indicator.down({
        reason:
          snapshot.lifecyclePhase === AppLifecyclePhase.DEGRADED
            ? "database lost mid-run — recovery loop active"
            : "database is not reachable",
      });
    }

    return indicator.up({ phase: snapshot.lifecyclePhase });
  }

  /**
   * The swarm engine, from the lifecycle phase.
   *
   * Readiness requires the platform to be past bootstrap, because a node can be
   * swarm-active while the platform is still mid-onboarding — reporting green
   * there would let compose start the dashboard on a half-built platform.
   */
  swarm() {
    const indicator = this.healthIndicator.check("swarm");
    const snapshot = this.state.snapshot();

    if (
      snapshot.lifecyclePhase === AppLifecyclePhase.INITIALIZED ||
      snapshot.lifecyclePhase === AppLifecyclePhase.DISCOVERING ||
      snapshot.lifecyclePhase === AppLifecyclePhase.PROBING ||
      snapshot.lifecyclePhase === AppLifecyclePhase.BOOTSTRAPPING
    ) {
      return indicator.down({ reason: `setup is not complete — lifecycle phase is ${snapshot.lifecyclePhase}` });
    }

    if (snapshot.lifecyclePhase === AppLifecyclePhase.ERROR) {
      return indicator.down({ reason: "platform bootstrap failed — see the lifecycle error" });
    }

    return indicator.up({ phase: snapshot.lifecyclePhase });
  }

  /**
   * Every supervised platform service (ingress, redis, managed-web, the
   * failover proxy, global Postgres, the WireGuard sidecar), from the cached
   * snapshots the supervisors themselves publish.
   *
   * A failing set is named individually so the operator sees WHICH service is
   * behind, not just that something is.
   */
  services() {
    const indicator = this.healthIndicator.check("services");
    const health = this.state.snapshot().supervisors;

    if (health.length === 0) {
      return indicator.down({ reason: "no platform supervisors are registered yet" });
    }

    // ── DEFERRED IS NOT FAILING ────────────────────────────────────────────────
    // A supervisor in `pending` was deliberately NOT converged: its precondition
    // is unmet (no swarm yet, or the deployment owns the service). Nothing is
    // wrong, so counting it as unhealthy is what kept plain `dev` from ever
    // reporting ready:
    //
    //   4 of 4 supervised services are not healthy
    //   → /health/ready stays 503 → the container is unhealthy → compose tears
    //     the API down after `depends_on`, on a stack that is working fine.
    //
    // They are reported as `degraded` (HTTP 200 with a detail) instead: the
    // platform is usable, so compose must not gate on it, and the operator still
    // sees exactly which services are waiting and why.
    const active = health.filter((snapshot) => snapshot.state !== "pending");
    const deferred = health
      .filter((snapshot) => snapshot.state === "pending")
      .map((snapshot) => ({ supervisor: snapshot.supervisorId, state: snapshot.state, detail: snapshot.detail }));

    // ── A DEGRADED INGRESS IS NOT A BLOCKER *WHILE SETUP STILL HOLDS THE PORT* ─
    // This is a HANDOVER state, not a fault, and treating it as one deadlocked
    // onboarding completely:
    //
    //   1. setup runs a BOOTSTRAP ingress that owns the entry port;
    //   2. the API's ingress supervisor wants that same port, so its task fails
    //      with "driver failed programming external connectivity" and reports
    //      `degraded`;
    //   3. this indicator counted `degraded` as failing → /health/ready = 503;
    //   4. setup WAITS for the API to report ready before releasing the port
    //      (releasing earlier would leave `setup.<host>` unrouted);
    //   5. so the port was never released, and the API was never ready.
    //
    // Nothing here is broken — the ingress simply cannot bind a port that another
    // container is still serving. The handover resolves it the moment readiness
    // goes green, so readiness must not require it first.
    //
    // Scoped deliberately: ONLY an ingress whose detail names the entry port is
    // exempted. A genuinely broken ingress (bad image, crash-looping) still fails
    // readiness, so this cannot mask a real fault.
    const isHandoverPortConflict = (snapshot: { supervisorId: string; detail: string | null }): boolean =>
      snapshot.supervisorId === "platform-ingress-traefik" &&
      /ingress task not running|entry port|external connectivity|address already in use|port is taken/i.test(
        snapshot.detail ?? "",
      );

    // ── A SUPERVISOR THAT LOST THE RACE WITH PROVISIONING IS NOT A FAULT ──────
    // The API is started BEFORE setup provisions the database — the API existing
    // early is what lets setup hand over to it. So every DB-touching supervisor
    // races the schema and can lose by SECONDS:
    //
    //   [ManagedWebSupervisor] Convergence failed:
    //     insert into "app_config" ... on conflict ("key") do update ...
    //   (09:02:22, against a schema that finished migrating at 09:02:27)
    //
    // Counting that as a readiness failure deadlocked onboarding: setup waits for
    // `/health/ready` before releasing the entry port, readiness was red because
    // of the race, so the port was never released and the handover never ran.
    // The operator saw three services instead of five and an ingress that never
    // became swarm-managed — while nothing was actually broken.
    //
    // Matched on the DB-error TEXT rather than on a supervisor id, so it covers
    // every supervisor that touches the schema rather than one of them. A real
    // database fault still fails readiness: a connection refusal (ECONNREFUSED,
    // `database is not reachable`) does not match these patterns.
    const isProvisioningRace = (snapshot: { detail: string | null }): boolean =>
      /relation .* does not exist|insert into "app_config"|Failed query/i.test(snapshot.detail ?? "");

    const failing = active
      .filter((snapshot) => !snapshot.healthy)
      .filter((snapshot) => !isHandoverPortConflict(snapshot))
      .filter((snapshot) => !isProvisioningRace(snapshot))
      .map((snapshot) => ({ supervisor: snapshot.supervisorId, state: snapshot.state, detail: snapshot.detail }));

    const handoverPending = active
      .filter((snapshot) => !snapshot.healthy)
      .filter((snapshot) => isHandoverPortConflict(snapshot))
      .map((snapshot) => ({ supervisor: snapshot.supervisorId, state: snapshot.state, detail: snapshot.detail }));

    const awaitingProvisioning = active
      .filter((snapshot) => !snapshot.healthy)
      .filter((snapshot) => isProvisioningRace(snapshot))
      .map((snapshot) => ({ supervisor: snapshot.supervisorId, state: snapshot.state, detail: snapshot.detail }));

    if (failing.length > 0) {
      return indicator.down({
        reason: `${String(failing.length)} of ${String(health.length)} supervised services are not healthy`,
        failing,
      });
    }

    // Every active supervisor is healthy or waiting on the handover, but some are
    // waiting on a precondition.
    if (deferred.length > 0 || handoverPending.length > 0 || awaitingProvisioning.length > 0) {
      return indicator.up({
        deferred: [...deferred, ...handoverPending, ...awaitingProvisioning],
        reason:
          `${String(deferred.length + handoverPending.length + awaitingProvisioning.length)} of ` +
          `${String(health.length)} supervised services are ` +
          "deferred (waiting on a precondition, not failing)",
      });
    }

    const warnings = health.flatMap((snapshot) =>
      snapshot.warnings.map((warning) => ({ supervisor: snapshot.supervisorId, warning })),
    );

    // Warnings never FAIL readiness — they are non-fatal operator actions
    // (e.g. "entry port taken, running headless"). They are reported as
    // `degraded`, which Terminus turns into HTTP 200 with `status: degraded`:
    // the platform is usable, so compose must not gate on it, but the signal
    // still reaches the operator through the probe body.
    if (warnings.length > 0) {
      return indicator.degraded({ total: health.length, warnings });
    }

    return indicator.up({ total: health.length });
  }

  /**
   * The mesh overlay, from the lifecycle's `meshConnected` flag.
   *
   * A single-node cluster is legitimately "ready with no peers" — the
   * orchestrator records `meshConnected` for that case too, so this does not
   * need its own node-count query.
   */
  mesh() {
    const indicator = this.healthIndicator.check("mesh");
    const snapshot = this.state.snapshot();

    if (snapshot.meshConnected === null) {
      return indicator.down({ reason: "mesh status has not been established yet" });
    }
    if (!snapshot.meshConnected) {
      return indicator.down({ reason: "the mesh overlay is not connected" });
    }

    return indicator.up({ connected: true });
  }
}
