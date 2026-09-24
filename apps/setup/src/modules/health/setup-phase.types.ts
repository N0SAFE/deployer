/**
 * The setup app's lifecycle phase.
 *
 * The wizard walks these in order; `/setup/health` collapses them into the
 * binary answer compose consumes (see `SetupPhaseService`).
 */
export type SetupPhase =
  | "awaiting"    // the app just booted; nothing has happened yet
  | "clustering"  // founding or joining the swarm, bringing up WireGuard
  | "driving"     // the full API is being asked to provision
  | "handover"    // the API is green; the ingress is being retargeted
  | "ready"       // handed over — safe for compose to start api/web
  | "failed";     // terminal until the operator retries

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
 * (`awaiting → driving`) without keeping its own copy of the previous state —
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
