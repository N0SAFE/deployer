import { Context } from "effect";

import {
  DEFAULT_CALL_TIMEOUT_MS,
  DEFAULT_RELAY_MAX_HOPS,
  DEFAULT_RELAY_NEXT_HOP_ATTEMPTS,
  DEFAULT_RELAY_UNREACHABLE_MS,
} from "../../../config/node-agent.env";

/**
 * How far a forwarded call may travel, and how hard the agent tries to find a next hop.
 *
 * Deployment settings (`MESH_RELAY_*`), not node configuration: every agent of a deployment is told the same thing, and
 * `maxHops: 0` is the kill switch that makes forwarding a no-op again.
 */
export type RelaySettingsShape = {
  /** Agent hops a forwarded call may take. `0` disables forwarding entirely. */
  readonly maxHops: number;
  /** Next hops tried per forwarding decision. The first that answers wins. */
  readonly nextHopAttempts: number;
  /** How long a direct link that failed at the transport is remembered as unreachable. */
  readonly unreachableMs: number;
  /** How long one agent-to-agent call may take before it counts as a transport failure. */
  readonly callTimeoutMs: number;
};

export class RelaySettings extends Context.Service<RelaySettings, RelaySettingsShape>()("node-agent/RelaySettings") {
  static readonly live: RelaySettingsShape = {
    maxHops: DEFAULT_RELAY_MAX_HOPS,
    nextHopAttempts: DEFAULT_RELAY_NEXT_HOP_ATTEMPTS,
    unreachableMs: DEFAULT_RELAY_UNREACHABLE_MS,
    callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS,
  };
}
