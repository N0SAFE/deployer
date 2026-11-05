/**
 * Lifecycle state of a supervisor's last convergence attempt.
 *
 * `pending` is deliberately distinct from `degraded`: it means "the precondition for this resource
 * does not exist yet, so convergence was never attempted" (a swarm-only service before setup created
 * the cluster). `degraded` means "convergence was attempted and failed".
 */
export type SupervisorState =
    'idle' | 'converging' | 'converged' | 'degraded' | 'pending'
