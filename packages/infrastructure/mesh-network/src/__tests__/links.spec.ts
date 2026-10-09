import { describe, expect, it } from "vitest";

import { HANDSHAKE_FRESH_MS, planLinks, planRelay, PROBE_WINDOW_MS, rankCandidates } from "../links";
import type { EndpointCandidate, MemberEntry } from "../schemas";

function member(memberId: string, address: string, endpoints: EndpointCandidate[]): MemberEntry {
	return {
		clusterId: "c000000000000000000000000",
		memberId,
		signingKey: "3uzaSo9c/nnOmg9ipPglHPflpyK0WmoZ4F5spNh03zI=",
		wireguardKey: `${memberId.slice(1, 25).padEnd(43, "A")}=`,
		address,
		addressSalt: 0,
		name: memberId,
		kind: "node",
		endpoints,
		labels: {},
		version: 1,
		issuedAt: "2026-10-07T12:00:00.000Z",
		state: "active",
	};
}

const self = member("m000000000000000000000001", "100.88.0.1", [{ kind: "lan", host: "192.168.1.10", port: 51820 }]);
const peer = member("m000000000000000000000002", "100.88.0.2", [
	{ kind: "reflexive", host: "203.0.113.7", port: 51820 },
	{ kind: "lan", host: "10.0.0.4", port: 51820 },
	{ kind: "declared", host: "198.51.100.2", port: 51820 },
	{ kind: "lan", host: "192.168.1.20", port: 51820 },
]);

describe("rankCandidates", () => {
	it("puts a same-subnet LAN address first and a foreign LAN address last", () => {
		expect(rankCandidates(self, peer).map((c) => c.host)).toEqual(["192.168.1.20", "198.51.100.2", "203.0.113.7", "10.0.0.4"]);
	});

	it("de-duplicates identical host:port pairs", () => {
		const dup = member("m000000000000000000000003", "100.88.0.3", [
			{ kind: "lan", host: "192.168.1.30", port: 51820 },
			{ kind: "reflexive", host: "192.168.1.30", port: 51820 },
		]);
		expect(rankCandidates(self, dup)).toHaveLength(1);
	});
});

describe("planLinks", () => {
	const now = 1_000_000_000;

	it("keeps the endpoint WireGuard roamed to while the handshake is fresh", () => {
		const plan = planLinks({
			self,
			peers: [peer],
			observations: { [peer.memberId]: { endpoint: "203.0.113.99:40000", latestHandshakeAt: now - 1000 } },
			attempts: {},
			now,
		});
		expect(plan.peers[0]).toMatchObject({ path: "direct", endpoint: "203.0.113.99:40000", allowedIps: ["100.88.0.2/32"] });
	});

	it("tries the best candidate first, then moves on after one probe window", () => {
		const first = planLinks({ self, peers: [peer], observations: {}, attempts: {}, now });
		expect(first.peers[0]).toMatchObject({ path: "trying", endpoint: "192.168.1.20:51820" });

		const stillFirst = planLinks({ self, peers: [peer], observations: {}, attempts: first.attempts, now: now + PROBE_WINDOW_MS - 1 });
		expect(stillFirst.peers[0]?.endpoint).toBe("192.168.1.20:51820");

		const second = planLinks({ self, peers: [peer], observations: {}, attempts: first.attempts, now: now + PROBE_WINDOW_MS });
		expect(second.peers[0]?.endpoint).toBe("198.51.100.2:51820");
	});

	it("falls back to a relay after every candidate failed, then starts over", () => {
		let attempts = planLinks({ self, peers: [peer], observations: {}, attempts: {}, now }).attempts;
		let t = now;
		for (let i = 0; i < 4; i += 1) {
			t += PROBE_WINDOW_MS;
			attempts = planLinks({ self, peers: [peer], observations: {}, attempts, now: t }).attempts;
		}
		expect(planLinks({ self, peers: [peer], observations: {}, attempts, now: t }).peers[0]).toMatchObject({ path: "relay", endpoint: null });

		const restarted = planLinks({ self, peers: [peer], observations: {}, attempts, now: t + PROBE_WINDOW_MS });
		expect(restarted.peers[0]?.endpoint).toBe("192.168.1.20:51820");
	});

	it("treats a stale handshake as a dead link", () => {
		const plan = planLinks({
			self,
			peers: [peer],
			observations: { [peer.memberId]: { endpoint: "203.0.113.99:40000", latestHandshakeAt: now - HANDSHAKE_FRESH_MS } },
			attempts: {},
			now,
		});
		expect(plan.peers[0]?.path).toBe("trying");
	});

	it("waits passively for a peer that published no candidate", () => {
		const silent = member("m000000000000000000000004", "100.88.0.4", []);
		expect(planLinks({ self, peers: [silent], observations: {}, attempts: {}, now }).peers[0]).toMatchObject({ path: "passive", endpoint: null, persistentKeepaliveSeconds: 25 });
	});

	it("never plans a link to itself", () => {
		expect(planLinks({ self, peers: [self], observations: {}, attempts: {}, now }).peers).toEqual([]);
	});

	it("reports the relay transport as not available yet", () => {
		expect(planRelay(peer)).toEqual({ kind: "unavailable", reason: "relay-transport-not-implemented" });
	});
});
