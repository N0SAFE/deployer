import { describe, expect, it } from "vitest";

import { canonicalJson } from "../canonical-json";
import { generateMeshIdentity, signPayload, type MeshIdentity } from "../identity";
import {
	activeMembers,
	addressConflictLosers,
	admitMember,
	adoptRoster,
	createGenesis,
	createJoinRequest,
	getSetting,
	mergeRosters,
	revokeMember,
	RosterError,
	setSetting,
	updateSelfEntry,
	validateRoster,
} from "../roster";
import type { RosterState } from "../schemas";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 12, minute));

function cluster() {
	const founder = generateMeshIdentity();
	const roster = createGenesis(founder, { name: "node-a", endpoints: [{ kind: "lan", host: "192.168.1.10", port: 51820 }] }, at(0));
	return { founder, roster };
}

function join(roster: RosterState, admitter: MeshIdentity, name: string, minute: number) {
	const joiner = generateMeshIdentity();
	const genesis = roster.genesis.record;
	const request = createJoinRequest(joiner, { clusterId: genesis.clusterId, cidr: genesis.cidr }, { name }, 0, at(minute));
	const result = admitMember(roster, admitter, request, at(minute));
	return { joiner, roster: result.roster, admission: result.admission, request };
}

const ids = (roster: RosterState) => activeMembers(roster).map((member) => member.memberId).sort();

describe("genesis", () => {
	it("founds a one-member cluster whose ids derive from the founder's key", () => {
		const { founder, roster } = cluster();
		expect(ids(roster)).toEqual([founder.memberId]);
		expect(roster.genesis.record.memberId).toBe(founder.memberId);
		expect(validateRoster(roster).rejected).toEqual([]);
	});

	it("refuses a roster whose genesis was tampered with", () => {
		const { roster } = cluster();
		const forged = { ...roster, genesis: { ...roster.genesis, record: { ...roster.genesis.record, cidr: "10.0.0.0/8" } } };
		expect(() => validateRoster(forged)).toThrow(RosterError);
	});
});

describe("admission", () => {
	it("lets any active member admit, not only the founder", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const c = join(b.roster, b.joiner, "node-c", 2);
		expect(ids(c.roster)).toEqual([founder.memberId, b.joiner.memberId, c.joiner.memberId].sort());
		expect(c.admission.record.admittedBy).toBe(b.joiner.memberId);
	});

	it("is idempotent for a joiner that asks twice", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const again = admitMember(b.roster, founder, b.request, at(5));
		expect(again.admission).toEqual(b.admission);
	});

	it("rejects a request for another cluster", () => {
		const { founder, roster } = cluster();
		const other = cluster();
		const joiner = generateMeshIdentity();
		const request = createJoinRequest(joiner, { clusterId: other.roster.genesis.record.clusterId, cidr: "100.88.0.0/16" }, { name: "x" });
		expect(() => admitMember(roster, founder, request)).toThrow(expect.objectContaining({ code: "cluster-mismatch" }));
	});

	it("rejects a request not signed by its own key", () => {
		const { founder, roster } = cluster();
		const joiner = generateMeshIdentity();
		const request = createJoinRequest(joiner, { clusterId: roster.genesis.record.clusterId, cidr: "100.88.0.0/16" }, { name: "x" });
		const tampered = { ...request, record: { ...request.record, name: "evil" } };
		expect(() => admitMember(roster, founder, tampered)).toThrow(expect.objectContaining({ code: "invalid-signature" }));
	});

	it("rejects an address that is not derived from the key", () => {
		const { founder, roster } = cluster();
		const joiner = generateMeshIdentity();
		const base = createJoinRequest(joiner, { clusterId: roster.genesis.record.clusterId, cidr: "100.88.0.0/16" }, { name: "x" });
		const record = { ...base.record, address: "100.88.0.1" };
		const request = { record, signature: signPayload(record, joiner.signingPrivateKey) };
		expect(() => admitMember(roster, founder, request)).toThrow(expect.objectContaining({ code: "address-mismatch" }));
	});

	it("rejects a joiner whose address an active member already holds", () => {
		const { founder, roster } = cluster();
		// The founder's own key re-requesting under a new member identity is the
		// simplest way to force the same derived address.
		const clone: MeshIdentity = { ...generateMeshIdentity(), wireguardKey: founder.wireguardKey, wireguardPrivateKey: founder.wireguardPrivateKey };
		const request = createJoinRequest(clone, { clusterId: roster.genesis.record.clusterId, cidr: "100.88.0.0/16" }, { name: "x" });
		expect(() => admitMember(roster, founder, request)).toThrow(expect.objectContaining({ code: "address-collision" }));
	});

	it("drops an admission granted by a non-member during merge", () => {
		const { roster } = cluster();
		const outsider = generateMeshIdentity();
		const victim = generateMeshIdentity();
		const genesis = roster.genesis.record;
		const admission = {
			record: { clusterId: genesis.clusterId, memberId: victim.memberId, signingKey: victim.signingKey, admittedBy: outsider.memberId, admittedAt: at(1).toISOString() },
		};
		const forged = { ...roster, admissions: { ...roster.admissions, [victim.memberId]: { ...admission, signature: signPayload(admission.record, outsider.signingPrivateKey) } } };
		expect(Object.keys(mergeRosters(roster, forged).admissions)).toEqual([genesis.memberId]);
	});

	it("lets the joiner adopt only a roster that admits it", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		expect(ids(adoptRoster(b.joiner, b.roster))).toContain(b.joiner.memberId);
		expect(() => adoptRoster(generateMeshIdentity(), b.roster)).toThrow(expect.objectContaining({ code: "not-a-member" }));
	});
});

describe("merge", () => {
	it("converges regardless of order — commutative, associative, idempotent", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const c = join(roster, founder, "node-c", 2);
		const d = join(b.roster, b.joiner, "node-d", 3);
		const withSetting = setSetting(c.roster, c.joiner, "ingress", { lanes: ["local"] }, at(4));

		const copies = [b.roster, d.roster, withSetting];
		const orders = [
			[0, 1, 2],
			[2, 1, 0],
			[1, 0, 2],
			[2, 0, 1],
		];
		const results = orders.map((order) =>
			canonicalJson(order.slice(1).reduce((acc, index) => mergeRosters(acc, copies[index]!), copies[order[0]!]!)),
		);
		expect(new Set(results).size).toBe(1);

		const merged = mergeRosters(mergeRosters(b.roster, d.roster), withSetting);
		expect(canonicalJson(mergeRosters(merged, merged))).toBe(canonicalJson(merged));
		expect(ids(merged)).toHaveLength(4);
		expect(getSetting(merged, "ingress")).toEqual({ lanes: ["local"] });
	});

	it("never blends two different clusters", () => {
		expect(() => mergeRosters(cluster().roster, cluster().roster)).toThrow(expect.objectContaining({ code: "cluster-mismatch" }));
	});

	it("keeps the highest version of a member's entry", () => {
		const { founder, roster } = cluster();
		const newer = updateSelfEntry(roster, founder, { name: "renamed" }, at(3));
		expect(mergeRosters(newer, roster).members[founder.memberId]?.record.name).toBe("renamed");
		expect(mergeRosters(roster, newer).members[founder.memberId]?.record.name).toBe("renamed");
	});

	it("does not let a forged entry with a higher version shadow the real one", () => {
		const { founder, roster } = cluster();
		const entry = roster.members[founder.memberId];
		if (entry === undefined) throw new Error("missing entry");
		const forged = { record: { ...entry.record, version: 99, name: "evil" }, signature: entry.signature };
		const poisoned = { ...roster, members: { [founder.memberId]: forged } };
		expect(mergeRosters(roster, poisoned).members[founder.memberId]?.record.name).toBe("node-a");
	});
});

describe("self entry", () => {
	it("does not bump the version when nothing changed", () => {
		const { founder, roster } = cluster();
		const current = roster.members[founder.memberId]?.record;
		expect(updateSelfEntry(roster, founder, { name: current?.name, endpoints: current?.endpoints }, at(9))).toBe(roster);
	});

	it("re-derives the address when the salt changes", () => {
		const { founder, roster } = cluster();
		const before = roster.members[founder.memberId]?.record.address;
		const after = updateSelfEntry(roster, founder, { addressSalt: 1 }, at(2)).members[founder.memberId]?.record.address;
		expect(after).not.toBe(before);
	});
});

describe("revocation", () => {
	it("removes the member for good and keeps the rest of the cluster working", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const revoked = revokeMember(b.roster, b.joiner, founder.memberId, "decommissioned", at(2));
		expect(ids(revoked)).toEqual([b.joiner.memberId]);

		// The founder is gone, yet the survivor can still admit — no source of truth.
		const c = join(revoked, b.joiner, "node-c", 3);
		expect(ids(c.roster)).toEqual([b.joiner.memberId, c.joiner.memberId].sort());
	});

	it("voids what a revoked member signs after its revocation, not before", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const early = join(b.roster, b.joiner, "node-c", 2);
		const revoked = revokeMember(early.roster, founder, b.joiner.memberId, "compromised", at(3));
		expect(ids(revoked)).toContain(early.joiner.memberId);

		// b keeps an old copy and admits someone after it was revoked.
		const late = join(early.roster, b.joiner, "node-d", 4);
		const merged = mergeRosters(revoked, late.roster);
		expect(ids(merged)).not.toContain(late.joiner.memberId);
		expect(ids(merged)).not.toContain(b.joiner.memberId);
	});

	it("refuses to readmit a revoked identity", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const revoked = revokeMember(b.roster, founder, b.joiner.memberId, "gone", at(2));
		expect(() => admitMember(revoked, founder, b.request, at(3))).toThrow(expect.objectContaining({ code: "revoked" }));
	});
});

describe("settings", () => {
	it("keeps the last write and ignores a no-op write", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const first = setSetting(b.roster, founder, "k", 1, at(2));
		const second = setSetting(first, b.joiner, "k", 2, at(3));
		expect(getSetting(mergeRosters(first, second), "k")).toBe(2);
		expect(setSetting(second, founder, "k", 2, at(4))).toBe(second);
	});
});

describe("address conflicts", () => {
	it("names the later-admitted member as the one that must move", () => {
		const { founder, roster } = cluster();
		const b = join(roster, founder, "node-b", 1);
		const founderAddress = b.roster.members[founder.memberId]?.record.address;
		// Force b onto the founder's address by publishing a salt that collides —
		// simulated by rewriting b's key to the founder's WireGuard key.
		const entry = b.roster.members[b.joiner.memberId]?.record;
		if (entry === undefined || founderAddress === undefined) throw new Error("missing");
		const colliding = { ...entry, wireguardKey: founder.wireguardKey, address: founderAddress, version: entry.version + 1 };
		const forcedB = { ...b.roster, members: { ...b.roster.members, [b.joiner.memberId]: { record: colliding, signature: signPayload(colliding, b.joiner.signingPrivateKey) } } };
		expect([...addressConflictLosers(validateRoster(forcedB).roster)]).toEqual([b.joiner.memberId]);
	});
});
