import { Context } from 'effect'

import type { SetupPhaseShape } from './setup-phase.service'
import type {
    HealthIndicatorResult,
    HealthIndicatorService,
} from '@nestjs/terminus'

export interface SetupReadinessIndicatorShape {
    check(): HealthIndicatorResult
}

export class SetupReadinessIndicator extends Context.Service<
    SetupReadinessIndicator,
    SetupReadinessIndicatorShape
>()('setup/SetupReadinessIndicator') {}

/**
 * The setup app's readiness indicator — the compose gate.
 *
 * Terminus maps this to a real HTTP status: `up` → 200, `down` → 503. That
 * matters because compose cannot parse a JSON body, so the STATUS CODE is the
 * entire contract. `bff`/`web-dev` therefore need no `healthcheck.sh`
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
export function makeSetupReadinessIndicator(
    healthIndicator: HealthIndicatorService,
    phases: SetupPhaseShape
): SetupReadinessIndicatorShape {
    return {
        check() {
            const indicator = healthIndicator.check('setup')
            const snapshot = phases.current()

            // ── THE VERDICT COMES FROM THE GATE, NOT FROM A PHASE NAME ───────────────
            // Delegating to `phases.isReady()` is load-bearing: a hardcoded `phase === "ready"` silently disagreed with
            // the gate once it moved to `launching`, and compose would have waited forever for an API it was refusing to
            // start. One predicate, one meaning: "the API may start".
            const detail = {
                phase: snapshot.phase,
                detail: snapshot.detail,
                apiUp: snapshot.apiUp,
                apiReady: snapshot.apiReady,
            }
            // A failure reports the REASON as the detail so the operator sees the actionable cause in the probe body.
            return phases.isReady()
                ? indicator.up(detail)
                : indicator.down(detail)
        },
    }
}
