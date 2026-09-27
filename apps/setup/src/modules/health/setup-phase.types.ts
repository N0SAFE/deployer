/**
 * The setup app's lifecycle phase.
 *
 * The wizard walks these in order; `/setup/health` collapses them into the
 * binary answer compose consumes (see `SetupPhaseService`).
 *
 * ── THE ONE PHASE THAT MATTERS: `launching` ─────────────────────────────────
 * `launching` is the GATE. Everything before it is setup doing its own job with
 * no API in existence; everything after it describes a platform that has been
 * started. Getting this boundary wrong is what produced the earlier design's
 * circular dependency — setup reported ready only once the API was green, while
 * the API waited for setup to be healthy to start at all.
 *
 * So the rule is: the gate opens when the WIZARD IS DONE, which is a fact about
 * THIS process. It never depends on the API, because the API's existence is what
 * the gate enables.
 */
export type SetupPhase =
  | "awaiting"      // the app just booted; nothing has happened yet
  | "clustering"    // founding or joining the swarm, applying the node policy
  | "collecting"    // the wizard is serving the form (or skipped: already done)
  | "launching"     // choices persisted — THE GATE IS OPEN, the API may start
  | "provisioning"  // the API is up and provisioning itself
  | "handover"      // the API is green; the ingress is being retargeted
  | "ready"         // converged — setup is about to exit
  | "failed";       // terminal until the operator retries

/** What the operator is told, and what the wizard renders. */
export interface SetupPhaseSnapshot {
  phase: SetupPhase;
  /** Human-readable detail for the current phase. */
  detail: string;
  /** Whether the full API answered `GET /health` yet. */
  apiUp: boolean;
  /** Whether the full API's `GET /health/ready` returned 200. */
  apiReady: boolean;
  /** ISO 8601 timestamp of the last transition. */
  updatedAt: string;
}

/**
 * A phase transition, published on the service's event stream.
 *
 * Carries BOTH sides of the change so a subscriber can react to the edge
 * (`awaiting → collecting`) without keeping its own copy of the previous state —
 * which is what would otherwise turn every consumer into a poller.
 */
export interface SetupPhaseEvent {
  /** Phase before the transition. */
  from: SetupPhase;
  /** Phase after the transition. */
  to: SetupPhase;
  /** The snapshot AFTER the transition (never partial). */
  snapshot: SetupPhaseSnapshot;
  /** ISO 8601 timestamp of the event. */
  at: string;
}
