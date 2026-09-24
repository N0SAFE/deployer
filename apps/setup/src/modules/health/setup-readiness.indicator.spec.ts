import { describe, expect, it } from "vitest";
import { HealthIndicatorService } from "@nestjs/terminus";

import { SetupReadinessIndicator } from "./setup-readiness.indicator";
import { SetupPhaseService } from "./setup-phase.service";

/**
 * The indicator is the last step before compose decides. Its whole job is to
 * turn the phase into `up`/`down`, so the assertions are about the STATUS
 * COMPOSE SEES — a false `up` starts the dashboard on a half-built platform.
 *
 * The real `HealthIndicatorService` is used, not a stub: the `up`/`down` payload
 * shape is the contract the operator reads, so faking it would test nothing.
 */
function makeIndicator(): { indicator: SetupReadinessIndicator; phases: SetupPhaseService } {
  const phases = new SetupPhaseService();
  const indicator = new SetupReadinessIndicator(new HealthIndicatorService(), phases);
  return { indicator, phases };
}

describe("SetupReadinessIndicator", () => {
  it("is down while awaiting, and names the phase", () => {
    const { indicator } = makeIndicator();

    const result = indicator.check();

    expect(result.setup).toMatchObject({ status: "down", phase: "awaiting" });
  });

  it("stays down through every in-progress phase", () => {
    const { indicator, phases } = makeIndicator();

    for (const phase of ["clustering", "driving", "handover"] as const) {
      phases.reset();
      phases.record(phase, `${phase}…`);

      // Compose gates on this: any of these reporting up would let the
      // dashboard start before the platform can serve it.
      expect(indicator.check().setup, `${phase} must report down`).toMatchObject({ status: "down" });
    }
  });

  it("is up exactly once the handover completes", () => {
    const { indicator, phases } = makeIndicator();

    phases.record("ready", "handed over");

    expect(indicator.check().setup).toMatchObject({ status: "up", phase: "ready" });
  });

  it("surfaces the failure reason in the probe body", () => {
    const { indicator, phases } = makeIndicator();

    phases.fail("the engine refused to schedule the ingress task");

    // The 503 body is the only channel the operator has from compose; a bare
    // "down" with no reason would send them to the logs for no reason.
    expect(indicator.check().setup).toMatchObject({
      status: "down",
      phase: "failed",
      detail: "the engine refused to schedule the ingress task",
    });
  });

  it("reports the API flags, so a 503 says WHICH dependency is missing", () => {
    const { indicator, phases } = makeIndicator();

    phases.record("driving", "waiting for the API to become ready", { apiUp: true, apiReady: false });

    expect(indicator.check().setup).toMatchObject({ apiUp: true, apiReady: false });
  });
});
