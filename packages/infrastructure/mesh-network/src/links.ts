/**
 * Link planning — for every peer, which endpoint WireGuard should send to right now.
 *
 * Pure: the agent feeds in the roster and what `wg show` observed, and applies the
 * plan it gets back. Keeping the decision here means every rule below is tested
 * without a kernel, and the agent stays a thin loop.
 *
 * ── THE ORDER ───────────────────────────────────────────────────────────────────
 *   1. a fresh handshake wins outright — WireGuard roamed to wherever the peer
 *      actually is, and overriding that with a guess would break a working link;
 *   2. otherwise try the peer's candidates, best first, one window each:
 *        same-subnet LAN → declared (a `direct` node) → reflexive (hole punch) → other LAN
 *   3. when every candidate failed, the link needs a RELAY through another member
 *      (`planRelay`, not implemented in this pass), then the cycle starts over.
 *
 * Nothing in this order requires the local node to accept an unsolicited packet:
 * every attempt is an outbound send plus a keepalive, which is what opens the NAT
 * mapping the peer's own attempt needs (simultaneous open).
 */

import { ipv4ToInt } from "./address";
import type { EndpointCandidate, MemberEntry } from "./schemas";

/**
 * A handshake younger than this proves the current endpoint works.
 *
 * WireGuard's REJECT_AFTER_TIME: past it, the session's keys are dead and a
 * handshake must have been renewed if the link is alive.
 */
export const HANDSHAKE_FRESH_MS = 180_000;
/** How long one candidate gets before the next is tried. */
export const PROBE_WINDOW_MS = 20_000;
/** Keepalive keeps NAT mappings open from both sides; 25 s is WireGuard's own advice. */
export const PERSISTENT_KEEPALIVE_SECONDS = 25;

/** What `wg show` reports for one peer. */
export type LinkObservation = {
	/** `host:port` WireGuard is currently sending to, or null. */
	endpoint: string | null;
	/** Epoch ms of the latest handshake, or null when there has never been one. */
	latestHandshakeAt: number | null;
}

/** Where the planner is in a peer's candidate list. Carried between ticks. */
export type LinkAttempt = {
	/** Index into the ranked candidates; `candidates.length` means the relay phase. */
	candidateIndex: number;
	startedAt: number;
}

/**
 *   direct   a handshake is fresh — the link works
 *   trying   sending to `candidate`, waiting for a handshake
 *   relay    every candidate failed; the link needs a relay (see `planRelay`)
 *   passive  the peer published no candidate — wait for it to reach us
 */
export type LinkPath = "direct" | "trying" | "relay" | "passive";

export type PlannedPeer = {
	memberId: string;
	wireguardKey: string;
	allowedIps: string[];
	/** `host:port`, or null to leave WireGuard's endpoint unset/as roamed. */
	endpoint: string | null;
	persistentKeepaliveSeconds: number;
	path: LinkPath;
	candidate: EndpointCandidate | null;
}

export type LinkPlanInput = {
	self: MemberEntry;
	peers: readonly MemberEntry[];
	observations: Readonly<Record<string, LinkObservation | undefined>>;
	attempts: Readonly<Record<string, LinkAttempt | undefined>>;
	now: number;
}

export type LinkPlan = {
	peers: PlannedPeer[];
	attempts: Record<string, LinkAttempt>;
}

function sameSubnet24(a: string, b: string): boolean {
	return Math.floor(ipv4ToInt(a) / 256) === Math.floor(ipv4ToInt(b) / 256);
}

function formatEndpoint(candidate: EndpointCandidate): string {
	return `${candidate.host}:${String(candidate.port)}`;
}

/**
 * The peer's candidates, best first, de-duplicated by `host:port`.
 *
 * A LAN address only beats everything when it shares a /24 with one of OUR LAN
 * addresses — a private address in some other network is unreachable from here,
 * and trying it first would spend a whole window on a guaranteed miss.
 */
export function rankCandidates(self: MemberEntry, peer: MemberEntry): EndpointCandidate[] {
	const ownLan = self.endpoints.filter((candidate) => candidate.kind === "lan").map((candidate) => candidate.host);
	const rank = (candidate: EndpointCandidate): number => {
		if (candidate.kind === "lan" && ownLan.some((host) => sameSubnet24(host, candidate.host))) return 0;
		if (candidate.kind === "declared") return 1;
		if (candidate.kind === "reflexive") return 2;
		return 3;
	};
	const seen = new Set<string>();
	return peer.endpoints
		.map((candidate, index) => ({ candidate, index }))
		.sort((a, b) => rank(a.candidate) - rank(b.candidate) || a.index - b.index)
		.map(({ candidate }) => candidate)
		.filter((candidate) => {
			const key = formatEndpoint(candidate);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
}

/** Plan every peer link for this tick. */
export function planLinks(input: LinkPlanInput): LinkPlan {
	const peers: PlannedPeer[] = [];
	const attempts: Record<string, LinkAttempt> = {};

	for (const peer of input.peers) {
		if (peer.memberId === input.self.memberId) continue;
		const base = {
			memberId: peer.memberId,
			wireguardKey: peer.wireguardKey,
			allowedIps: [`${peer.address}/32`],
			persistentKeepaliveSeconds: PERSISTENT_KEEPALIVE_SECONDS,
		};

		const observation = input.observations[peer.memberId];
		const fresh =
			observation?.latestHandshakeAt !== null &&
			observation?.latestHandshakeAt !== undefined &&
			input.now - observation.latestHandshakeAt < HANDSHAKE_FRESH_MS;
		if (fresh) {
			// Keep whatever WireGuard roamed to. Re-asserting a planned candidate here
			// would yank a working session back to an address that may not work.
			peers.push({ ...base, endpoint: observation.endpoint, path: "direct", candidate: null });
			continue;
		}

		const candidates = rankCandidates(input.self, peer);
		if (candidates.length === 0) {
			peers.push({ ...base, endpoint: null, path: "passive", candidate: null });
			continue;
		}

		const previous = input.attempts[peer.memberId];
		let attempt: LinkAttempt =
			previous === undefined || previous.candidateIndex > candidates.length
				? { candidateIndex: 0, startedAt: input.now }
				: previous;
		if (input.now - attempt.startedAt >= PROBE_WINDOW_MS) {
			// The relay phase also gets one window, then the cycle restarts: a peer
			// that was unreachable may have moved to a network where it is not.
			const nextIndex = attempt.candidateIndex >= candidates.length ? 0 : attempt.candidateIndex + 1;
			attempt = { candidateIndex: nextIndex, startedAt: input.now };
		}
		attempts[peer.memberId] = attempt;

		const candidate = candidates[attempt.candidateIndex];
		if (candidate === undefined) {
			peers.push({ ...base, endpoint: null, path: "relay", candidate: null });
			continue;
		}
		peers.push({ ...base, endpoint: formatEndpoint(candidate), path: "trying", candidate });
	}

	return { peers, attempts };
}

/** Why a relayed link is not available. */
export type RelayPlan = { kind: "unavailable"; reason: "relay-transport-not-implemented" };

/**
 * Relay a link through another member's outbound session.
 *
 * TODO(mesh-relay): the transport — a member that reaches both sides forwards the
 * WireGuard datagrams over its existing session (WebSocket over whatever lane it
 * has), with the endpoint pointed at a local relay port. Until it lands, a pair of
 * members behind symmetric NATs on both sides cannot link; every other topology can.
 */
export function planRelay(_peer: MemberEntry): RelayPlan {
	return { kind: "unavailable", reason: "relay-transport-not-implemented" };
}
