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
 * (cluster, collect, provision, handover), so this stays a cache read like the
 * API's readiness indicators.
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

    // ── THE VERDICT COMES FROM THE GATE, NOT FROM A PHASE NAME ───────────────
    // Delegating to `phases.isReady()` is load-bearing. An earlier version
    // hardcoded `snapshot.phase === "ready"`, which silently disagreed with the
    // gate once the gate moved to `launching`: the service would have reported
    // ready while this endpoint kept answering 503, and compose would have
    // waited forever for an API it was refusing to start.
    //
    // One predicate, one meaning: "the API may start".
    if (this.phases.isReady()) {
      return indicator.up({
        phase: snapshot.phase,
        detail: snapshot.detail,
        apiUp: snapshot.apiUp,
        apiReady: snapshot.apiReady,
      });
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
