import type { EgressPolicy } from "@deployer/effect-infra";

import { PeerIdentity } from "./peer-identity";

/** The outcome of probing an address for a live service. */
export type AddressProbeResult = {
  readonly valid: boolean;
  readonly reason?: string;
  readonly latencyMs?: number;
  readonly statusCode?: number;
  /** The probe URL that answered, when one did. */
  readonly probeUrl?: string;
};

export type ProbeAddressOptions = {
  /** Which egress policy the probes run under (what they may reach). */
  readonly policy: EgressPolicy;
  /** Paths to try, in order, appended to the normalized origin. */
  readonly paths: readonly string[];
  /**
   * Also try each path over the other scheme (`https`→`http`).
   *
   * A node that has not obtained its certificate yet still answers plainly on
   * `http`; treating that as "down" would misreport a healthy host.
   */
  readonly tryBothSchemes?: boolean;
  /** Failure message builder, so the caller owns the remediation text. */
  readonly failureReason?: (address: string) => string;
};

/** The outcome of probing a peer's identity endpoint. */
export type PeerProbeResult = {
  readonly url: string;
  readonly reachable: boolean;
  readonly probeUrl: string;
  readonly latencyMs: number;
  readonly identity?: PeerIdentity;
  readonly error?: string;
};

export type ProbePeerOptions = {
  readonly policy: EgressPolicy;
  /** Primary path, e.g. `/mesh/ping`. */
  readonly primaryPath: string;
  /**
   * Path used when the primary answers non-2xx.
   *
   * A node that has not finished booting may expose only its always-on liveness
   * route; without the fallback, "nothing is listening" and "the peer is alive but
   * not ready" are indistinguishable.
   */
  readonly fallbackPath?: string;
};
