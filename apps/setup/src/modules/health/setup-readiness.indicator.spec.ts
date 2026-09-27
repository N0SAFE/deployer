import { describe, expect, it } from "vitest";
import { HealthIndicatorService } from "@nestjs/terminus";

import { SetupReadinessIndicator } from "./setup-readiness.indicator";
import { SetupPhaseService } from "./setup-phase.service";

/**
 * The indicator is the last step before compose decides. Its whole job is to
 * turn the phase into `up`/`down` — and `up` means "the API may start" — so the
 * assertions are about the STATUS COMPOSE SEES. A false `up` starts the API
 * before the operator has supplied a database; a false `down` after the gate
 * opened would tear a provisioning API back down.
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

  it("stays down through the phases BEFORE the details are collected", () => {
    const { indicator, phases } = makeIndicator();

    for (const phase of ["clustering", "collecting"] as const) {
      phases.reset();
      phases.record(phase, `${phase}…`);

      // Compose gates the API on this: reporting up here would start an API
      // whose boot has no `databaseUrl` to read.
      expect(indicator.check().setup, `${phase} must report down`).toMatchObject({ status: "down" });
    }
  });

  it("is up from `launching` onward — the gate the API starts behind", () => {
    const { indicator, phases } = makeIndicator();

    phases.record("launching", "details collected");
    expect(indicator.check().setup).toMatchObject({ status: "up", phase: "launching" });

    // And it STAYS up: compose re-probes continuously, so a dip back to 503
    // while the API is provisioning would tear it down mid-boot.
    for (const phase of ["provisioning", "handover", "ready"] as const) {
      phases.record(phase, `${phase}…`);
      expect(indicator.check().setup, `${phase} must still report up`).toMatchObject({ status: "up" });
    }
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

    // These flags describe a platform that is ALREADY starting — the gate is
    // open by definition once we are waiting on the API — so they are reported
    // alongside an `up` verdict for the operator's benefit, not as the reason.
    phases.record("provisioning", "waiting for the API to become ready", { apiUp: true, apiReady: false });

    expect(indicator.check().setup).toMatchObject({ apiUp: true, apiReady: false });
  });
});
