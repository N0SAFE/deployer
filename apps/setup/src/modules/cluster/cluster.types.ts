import type { ClusterSwarmRole } from "@repo/contracts-entities";

/**
 * What the cluster bootstrap reports back.
 *
 * A discriminated union rather than `{ ok: boolean; reason?: string }`: the
 * failure branch must CARRY its reason, so a consumer reacting to
 * `result.ok === false` has the text it needs without a second lookup or a
 * non-null assertion. It also makes the success fields unreachable on failure,
 * instead of silently `undefined`.
 */
export type ClusterBootstrapResult =
  | {
      ok: true;
      nodeId: string;
      swarmRole: ClusterSwarmRole;
      nodeCount: number;
      managerCount: number;
    }
  | { ok: false; reason: string };

/**
 * How this node should enter the cluster.
 *
 * Mirrors `SETUP_MODE` but is a distinct vocabulary: the env value describes
 * which APP path runs, this describes the ENGINE action. Keeping them apart
 * means a future mode (e.g. "attach to a managed cluster and do nothing") does
 * not have to overload an environment variable.
 */
export type ClusterEntryMode =
  | { kind: "found" }
  | { kind: "join"; joinToken: string; remoteAddrs: string[] };
