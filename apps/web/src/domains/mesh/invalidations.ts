import { defineInvalidations, type InvalidationConfig } from "@/domains/shared/helpers";
import { meshEndpoints } from "./endpoints";

/**
 * Mesh domain cache invalidations.
 *
 * Supports two modes in the same function:
 *
 * 1. **Flat key-based** (standard) — `keys.X()` invalidates that specific key:
 *    ```ts
 *    connectPeer: ({ keys }) => [keys.getLocalNode(), keys.listPeers()]
 *    ```
 *
 * 2. **Graph-based** (cascading) — `invalidations.X()` creates a dependency edge:
 *    when X is invalidated, all mutations that reference X via `invalidations`
 *    are transitively re-evaluated with cycle detection.
 *    `keys.X()` still works for direct keys alongside it.
 *
 * Graph edges auto-derived from `invalidations.X()` calls:
 *   trustKeyringStatus     ← [trustKeyringRotate, regenerateNodeConfigSecret]
 *   trustKeyringSecrets    ← [trustKeyringRotate, regenerateNodeConfigSecret]
 *   trustStrictReadiness   ← [trustKeyringRotate, trustStrictModeSet, trustStrictRollback]
 *
 * Example cascade — when trustKeyringRotate fires:
 *   → invalidates trustKeyringStatus, trustKeyringSecrets, trustStrictReadiness (direct refs)
 *   → cascades to regenerateNodeConfigSecret (via trustKeyringStatus) → adds keys.getNodeConfig()
 *   → cascades to trustStrictModeSet/trustStrictRollback (via trustStrictReadiness) → adds keys.trustStrictRolloutPlan()
 *   → plus direct key: keys.trustKeyringConvergenceStatus()
 */
export const meshInvalidations: ReturnType<
  typeof defineInvalidations<typeof meshEndpoints, InvalidationConfig<typeof meshEndpoints>>
> = defineInvalidations(meshEndpoints, {
  // ── Flat: no cascading ────────────────────────────────────────────────
  connectPeer: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  disconnectPeer: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  reconcileMembership: ({ keys }) => [
    keys.getLocalNode(),
    keys.listPeers(),
    keys.listPeerSessions(),
    keys.membershipSnapshot(),
  ],
  upsertResourceIndex: ({ keys }) => [
    keys.membershipSnapshot(),
  ],
  updateNodeConfig: ({ keys }) => [
    keys.getNodeConfig(),
    keys.getLocalNode(),
  ],

  // ── Graph: cascading with cycle detection ────────────────────────────
  trustKeyringRotate: ({ invalidations, keys }) => [
    invalidations.trustKeyringStatus(),
    invalidations.trustKeyringSecrets(),
    keys.trustKeyringConvergenceStatus(),
    invalidations.trustStrictReadiness(),
  ],
  trustStrictModeSet: ({ invalidations, keys }) => [
    invalidations.trustStrictReadiness(),
    keys.trustStrictRolloutPlan(),
  ],
  trustStrictRollback: ({ invalidations, keys }) => [
    invalidations.trustStrictReadiness(),
    keys.trustStrictRolloutPlan(),
  ],
  regenerateNodeConfigSecret: ({ invalidations, keys }) => [
    keys.getNodeConfig(),
    invalidations.trustKeyringStatus(),
    invalidations.trustKeyringSecrets(),
  ],
});
