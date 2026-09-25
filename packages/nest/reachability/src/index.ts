/**
 * @repo/nest-reachability — generic network probing.
 *
 * WHAT THIS PACKAGE IS
 * Two primitives, consumed by both apps:
 *   - `probeAddress`  — normalize an address and probe paths until one answers
 *                       2xx. Used to verify a node's public address actually
 *                       points at it before it is saved.
 *   - `probePeer`     — probe another node's identity endpoint (with a liveness
 *                       fallback). Used before joining a remote cluster.
 *
 * Plus the address helpers those two need: `hostOf`, `isIpAddress`, `toOrigin`.
 *
 * CONSUMERS (measured)
 *   apps/api    — `ReachabilityService.checkAddress` / `checkPeer`, which own
 *                 this platform's policy around a probe.
 *   apps/setup  — the wizard's mesh probe, which asks "is this cluster URL
 *                 reachable?" before an operator enrols the node. That second
 *                 consumer is what justifies the package: the probing LOGIC is
 *                 identical in both, only the policy around it differs.
 *
 * The wizard currently lives in `apps/api` (`sub-apps/setup-wizard`) and moves
 * to `apps/setup` in phase 4 of the setup-app refactor. Until that move, the
 * API is the only importer — the package is deliberately prepared for its
 * second consumer rather than extracted after the fact.
 *
 * WHAT IT IS NOT
 * No node model, no `node_network_config` access, no reachability RULES. The
 * platform's policy — which address wins (tunnel hostname vs public address),
 * that a tunnel needs an ACTIVE provider to grant a domain, that an address must
 * verify before it is persisted — stays in the app that owns it. Those
 * describe THIS platform's behaviour, and exporting them here would imply a
 * contract no second app honours.
 *
 * There is deliberately no module: this is a set of pure functions with no state
 * and no dependencies, so an app imports them directly and wires them into
 * whatever service owns the policy.
 */
export {
	hostOf,
	isIpAddress,
	toOrigin,
	probeAddress,
	probePeer,
} from "./services/network-probe";
export type {
	AddressProbeResult,
	ProbeAddressOptions,
	PeerIdentity,
	PeerProbeResult,
	PeerProbeOptions,
} from "./services/network-probe";
