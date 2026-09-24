import { Injectable } from "@nestjs/common";
import { HealthIndicatorService } from "@nestjs/terminus";

import { SetupPhaseService } from "./setup-phase.service";

/**
 * The setup app's readiness indicator — the compose gate.
 *
 * Terminus maps this to a real HTTP status: `up` → 200, `down` → 503. That
 * matters because compose cannot parse a JSON body, so the STATUS CODE is the
 * entire contract. `api-dev`/`web-dev` therefore need no `healthcheck.sh`
 * wrapper — a plain `wget --spider` is a correct probe.
 *
 * A pure read of the phase service's current value: no I/O, no polling. The
 * phase itself is advanced by events from the work that actually happens
 * (cluster, driving, handover), so this stays a cache read like the API's
 * readiness indicators.
 *
 * The indicator is deliberately binary (`ready` or not). The rich, human-facing
 * picture — phase, apiUp, apiReady, detail — lives in `GET /setup/state`, which
 * the wizard reads. Compose must never have to interpret nuance.
 */
@Injectable()
export class SetupReadinessIndicator {
  constructor(
    private readonly healthIndicator: HealthIndicatorService,
    private readonly phases: SetupPhaseService,
  ) {}

  check() {
    const indicator = this.healthIndicator.check("setup");
    const snapshot = this.phases.current();

    if (snapshot.phase === "ready") {
      return indicator.up({ phase: snapshot.phase, detail: snapshot.detail });
    }

    // A failure reports the REASON as the detail so the operator sees the
    // actionable cause in the probe body, not just a 503.
    return indicator.down({
      phase: snapshot.phase,
      detail: snapshot.detail,
      apiUp: snapshot.apiUp,
      apiReady: snapshot.apiReady,
    });
  }
}
