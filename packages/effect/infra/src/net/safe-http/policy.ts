import { Duration } from "effect";

import type { AddressClass } from "../ip-policy";

export type EgressPolicy = {
  readonly schemes: readonly ("http" | "https")[];
  /** Exact host (`api.github.com`) or suffix wildcard (`*.example.com`). Empty/undefined = any host the other rules allow. */
  readonly allowHosts?: readonly string[];
  /** Deny loopback, private, link-local, CGNAT, unspecified, multicast and reserved ranges. */
  readonly denyPrivate: boolean;
  /** Deny cloud metadata addresses even when `denyPrivate` is false. */
  readonly denyMetadata: boolean;
  /**
   * When set, EXACTLY these address classes are denied, replacing the all-or-nothing `denyPrivate`.
   * It lets a policy accept private LAN peers while still refusing loopback and link-local.
   */
  readonly denyClasses?: readonly AddressClass[];
  readonly timeout: Duration.Input;
  readonly maxBytes: number;
  /** Maximum redirect hops; each hop is re-validated. 0 disables following. */
  readonly followRedirects: number;
};

export const EgressPolicy = {
  /** Targets a user or tenant controls (webhook URLs, git URLs, domain checks, probes). */
  userSupplied: {
    schemes: ["https", "http"],
    denyPrivate: true,
    denyMetadata: true,
    timeout: Duration.seconds(10),
    maxBytes: 5 * 1024 * 1024,
    followRedirects: 3,
  },
  /**
   * A target an OPERATOR typed (a mesh peer, a node's address): private LAN ranges are normal
   * (home labs), but loopback, link-local, unspecified, multicast and reserved ranges are not,
   * and cloud metadata never. No redirects: a peer has no business redirecting a probe.
   */
  operatorTarget: {
    schemes: ["http", "https"],
    denyPrivate: false,
    denyClasses: ["loopback", "link-local", "unspecified", "multicast", "reserved"],
    denyMetadata: true,
    timeout: Duration.seconds(5),
    maxBytes: 1024 * 1024,
    followRedirects: 0,
  },
  /** Sibling platform services on the private network: private ranges allowed, metadata still denied. */
  internal: {
    schemes: ["http", "https"],
    denyPrivate: false,
    denyMetadata: true,
    timeout: Duration.seconds(10),
    maxBytes: 5 * 1024 * 1024,
    followRedirects: 0,
  },
} as const satisfies Record<string, EgressPolicy>;
