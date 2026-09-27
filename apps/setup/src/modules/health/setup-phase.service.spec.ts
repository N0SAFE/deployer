import { describe, expect, it } from "vitest";

import { SetupPhaseService } from "./setup-phase.service";

/**
 * `SetupPhaseService` is the single source of truth the compose gate reads, so
 * its transitions are asserted directly: getting them wrong either starts the
 * dashboard on a half-built platform (a false `ready`) or deadlocks the boot
 * (a `ready` that never arrives).
 */
function makeService(): SetupPhaseService {
  return new SetupPhaseService();
}

describe("SetupPhaseService", () => {
  it("starts awaiting, never ready", () => {
    const service = makeService();

    expect(service.current().phase).toBe("awaiting");
    expect(service.isReady()).toBe(false);
  });

  it("keeps the gate CLOSED until the details are collected", () => {
    const service = makeService();

    // These are the phases in which the API must NOT exist yet: nothing has been
    // collected, so its boot would have no `databaseUrl` to read. This is the
    // assertion that stops compose from starting the API too early.
    for (const phase of ["awaiting", "clustering", "collecting"] as const) {
      service.reset();
      service.record(phase, `${phase} in progress`);
      expect(service.isReady(), `${phase} must keep the gate closed`).toBe(false);
    }
  });

  it("opens the gate at `launching` and KEEPS it open through the handover", () => {
    const service = makeService();

    service.record("launching", "details collected");
    expect(service.isReady(), "launching must open the gate").toBe(true);

    // CRITICAL: the later phases must not close it again. Compose re-probes the
    // healthcheck for the whole life of the container, so a `503` here would
    // tear the API back down while it was provisioning — a self-inflicted
    // outage in the middle of onboarding.
    for (const phase of ["provisioning", "handover", "ready"] as const) {
      service.record(phase, `${phase} in progress`);
      expect(service.isReady(), `${phase} must keep the gate open`).toBe(true);
    }
  });

  it("closes the gate again when the phase fails", () => {
    const service = makeService();

    service.record("launching", "details collected");
    expect(service.isReady()).toBe(true);

    service.fail("the engine refused to schedule the ingress task");

    // A failed setup must NOT report healthy: compose would treat the platform
    // as ready while the wizard is showing the operator an error, and the API
    // would keep a task slot for a node that cannot serve.
    expect(service.isReady(), "failed must close the gate").toBe(false);
  });

  it("carries apiUp/apiReady forward unless explicitly overridden", () => {
    const service = makeService();

    service.record("provisioning", "provisioning", { apiUp: true, apiReady: false });
    expect(service.current()).toMatchObject({ apiUp: true, apiReady: false });

    // A later transition that says nothing about the API must not silently
    // reset the flags — the wizard renders them, and a flip to false would
    // look like the API went down.
    service.record("handover", "retargeting the ingress");
    expect(service.current()).toMatchObject({ apiUp: true, apiReady: false });

    service.record("ready", "handed over", { apiReady: true });
    expect(service.current()).toMatchObject({ apiUp: true, apiReady: true });
  });

  it("makes failure sticky until an explicit reset", () => {
    const service = makeService();

    service.fail("the engine refused to schedule the ingress task");
    expect(service.current().phase).toBe("failed");
    expect(service.isReady()).toBe(false);

    // Progress after a failure must NOT erase it: the operator has not seen the
    // error yet, and a background retry that quietly succeeds would hide a real
    // problem.
    service.record("provisioning", "retrying");
    expect(service.current().phase).toBe("failed");
    expect(service.current().detail).toContain("engine refused");
  });

  it("clears a failure only via reset, so a re-run is deliberate", () => {
    const service = makeService();

    service.fail("boom");
    service.reset();

    expect(service.current().phase).toBe("awaiting");
    // apiUp survives the reset (the API is still running), but apiReady must
    // NOT: the whole point of re-running is that readiness has to be re-earned.
    expect(service.current().apiReady).toBe(false);
  });

  it("stamps a parseable updatedAt, and re-stamps it on every transition", () => {
    const service = makeService();

    const first = service.current().updatedAt;
    expect(Number.isNaN(Date.parse(first))).toBe(false);

    // Monotonic non-decreasing rather than strictly increasing: two transitions
    // CAN land in the same millisecond, and asserting inequality would make this
    // test flaky. What matters is that the stamp is refreshed (never stale) and
    // never moves backwards.
    service.record("clustering", "founding the swarm");
    const second = service.current().updatedAt;
    expect(Number.isNaN(Date.parse(second))).toBe(false);
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first));
  });

  it("returns a copy, so a caller cannot mutate the phase behind the gate's back", () => {
    const service = makeService();

    const snapshot = service.current();
    snapshot.phase = "ready";

    // If this leaked, a component could mark setup complete by accident.
    expect(service.current().phase).toBe("awaiting");
    expect(service.isReady()).toBe(false);
  });
});
