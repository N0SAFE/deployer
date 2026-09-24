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

  it("only reports ready for the ready phase", () => {
    const service = makeService();

    // Every non-terminal phase must keep the gate CLOSED. This is the assertion
    // that stops compose from starting the dashboard too early.
    for (const phase of ["awaiting", "clustering", "driving", "handover"] as const) {
      service.reset();
      service.record(phase, `${phase} in progress`);
      expect(service.isReady(), `${phase} must not be ready`).toBe(false);
    }

    service.record("ready", "handed over");
    expect(service.isReady()).toBe(true);
  });

  it("carries apiUp/apiReady forward unless explicitly overridden", () => {
    const service = makeService();

    service.record("driving", "provisioning", { apiUp: true, apiReady: false });
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
    service.record("driving", "retrying");
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
