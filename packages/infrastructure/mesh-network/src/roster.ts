/**
 * The roster — the mesh's replicated state, with no owner.
 *
 * Every member holds a full copy and merges every copy it hears about. The merge is
 * a per-key choice over a TOTAL order (highest version, earliest admission, …), so
 * it is commutative, associative and idempotent: any set of members that has heard
 * the same records holds the same roster, whatever order the records arrived in.
 * That is the whole "no source of truth" property — there is nothing to ask, only
 * copies to merge.
 *
 * ── TRUST ───────────────────────────────────────────────────────────────────────
 * A record is only as good as its chain back to the genesis:
 *
 *   genesis ──admits──▶ A ──admits──▶ B ──admits──▶ C
 *
 * The genesis is the trust root, not a runtime dependency: once it has admitted
 * one other member it can disappear and every remaining member can still admit,
 * revoke and write settings. Records that do not chain back are dropped on every
 * merge, so a peer can relay only what members actually signed.
 *
 * Revocation is permanent and cuts the revoked member's authority at the moment it
 * was revoked: admissions/settings it signed BEFORE stay valid, later ones do not.
 * Timestamps are self-asserted, so a stolen key can backdate — the response to a
 * key compromise is a new cluster, which this module does not try to hide.
 */

import { DEFAULT_MESH_CIDR, cidrContains, deriveMeshAddress, parseCidr } from "./address";
import { canonicalJson } from "./canonical-json";
import { deriveClusterId, deriveMemberId, signPayload, verifyPayload, type MeshIdentity } from "./identity";
import {
	rosterStateSchema,
	signedMemberEntrySchema,
	type AdmissionRecord,
	type EndpointCandidate,
	type MemberEntry,
	type MemberKind,
	type MemberState,
	type RevocationRecord,
	type RosterState,
	type SettingRecord,
	type SignedAdmission,
	type SignedMemberEntry,
	type SignedRevocation,
	type SignedSetting,
} from "./schemas";

/** Default WireGuard listen port, fixed for the cluster at genesis. */
export const DEFAULT_MESH_LISTEN_PORT = 51_820;

export type RosterErrorCode =
	| "invalid-genesis"
	| "cluster-mismatch"
	| "invalid-signature"
	| "member-id-mismatch"
	| "address-mismatch"
	| "address-collision"
	| "not-a-member"
	| "revoked";

/** A typed failure. `code` is what callers branch on; the message is for humans. */
export class RosterError extends Error {
	constructor(
		readonly code: RosterErrorCode,
		message: string,
	) {
		super(message);
		this.name = "RosterError";
	}
}

/** A record `validateRoster` dropped, and why — surfaced in agent logs. */
export type RejectedRecord = {
	kind: "admission" | "member" | "revocation" | "setting";
	key: string;
	reason: string;
}

const MAX_FIXPOINT_PASSES = 8;

function nowIso(now: Date | undefined): string {
	return (now ?? new Date()).toISOString();
}

function sortedEntries<T>(record: Record<string, T>): [string, T][] {
	return Object.keys(record)
		.sort()
		.map((key) => [key, record[key] as T]);
}

// ─── Genesis & admission chain ───────────────────────────────────────────────

function assertGenesis(roster: RosterState): void {
	const { record, signature } = roster.genesis;
	if (!verifyPayload(record, signature, record.signingKey)) {
		throw new RosterError("invalid-genesis", "genesis signature does not verify");
	}
	if (deriveClusterId(record.signingKey) !== record.clusterId || deriveMemberId(record.signingKey) !== record.memberId) {
		throw new RosterError("invalid-genesis", "genesis ids are not derived from its key");
	}
	parseCidr(record.cidr);
}

/**
 * Admissions that chain back to the genesis, honouring revocation cut-offs.
 *
 * Iterates to a fixed point: an admission becomes valid once its admitter is, so a
 * chain arriving out of order still resolves in one call.
 */
function chainAdmissions(
	roster: RosterState,
	revokedAt: ReadonlyMap<string, string>,
	rejected: RejectedRecord[] | null,
): Map<string, SignedAdmission> {
	const genesis = roster.genesis.record;
	const valid = new Map<string, SignedAdmission>();

	const root = roster.admissions[genesis.memberId];
	if (
		root?.record.admittedBy !== genesis.memberId ||
		root.record.signingKey !== genesis.signingKey ||
		root.record.clusterId !== genesis.clusterId ||
		!verifyPayload(root.record, root.signature, genesis.signingKey)
	) {
		throw new RosterError("invalid-genesis", "the genesis member has no valid self-admission");
	}
	valid.set(genesis.memberId, root);

	const pending = sortedEntries(roster.admissions).filter(([memberId]) => memberId !== genesis.memberId);
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const [memberId, admission] of pending) {
			if (valid.has(memberId)) continue;
			const record = admission.record;
			const admitter = valid.get(record.admittedBy);
			if (admitter === undefined) continue;
			const admitterRevokedAt = revokedAt.get(record.admittedBy);
			if (admitterRevokedAt !== undefined && record.admittedAt >= admitterRevokedAt) continue;
			if (
				record.clusterId !== genesis.clusterId ||
				record.memberId !== memberId ||
				deriveMemberId(record.signingKey) !== memberId ||
				!verifyPayload(record, admission.signature, admitter.record.signingKey)
			) {
				continue;
			}
			valid.set(memberId, admission);
			progressed = true;
		}
	}

	if (rejected !== null) {
		for (const [memberId] of pending) {
			if (!valid.has(memberId)) {
				rejected.push({ kind: "admission", key: memberId, reason: "does not chain back to the genesis" });
			}
		}
	}
	return valid;
}

function validRevocations(
	roster: RosterState,
	admissions: ReadonlyMap<string, SignedAdmission>,
	revokedAt: ReadonlyMap<string, string>,
): Map<string, SignedRevocation> {
	const valid = new Map<string, SignedRevocation>();
	for (const [memberId, revocation] of sortedEntries(roster.revocations)) {
		const record = revocation.record;
		const revoker = admissions.get(record.revokedBy);
		if (revoker === undefined) continue;
		const revokerRevokedAt = revokedAt.get(record.revokedBy);
		if (revokerRevokedAt !== undefined && record.revokedAt >= revokerRevokedAt && record.revokedBy !== memberId) continue;
		if (
			record.clusterId !== roster.genesis.record.clusterId ||
			record.memberId !== memberId ||
			!verifyPayload(record, revocation.signature, revoker.record.signingKey)
		) {
			continue;
		}
		valid.set(memberId, revocation);
	}
	return valid;
}

function revocationTimes(revocations: ReadonlyMap<string, SignedRevocation>): Map<string, string> {
	return new Map([...revocations].map(([memberId, revocation]) => [memberId, revocation.record.revokedAt]));
}

function sameKeys(a: ReadonlyMap<string, unknown>, b: ReadonlyMap<string, unknown>): boolean {
	if (a.size !== b.size) return false;
	for (const key of a.keys()) if (!b.has(key)) return false;
	return true;
}

/**
 * Drop every record that does not hold up, and report what was dropped.
 *
 * Deterministic — keys are visited in sorted order and the revocation fixed point
 * is bounded — so two members validating the same roster drop the same records.
 * Throws only when the genesis itself is invalid: then there is no cluster to
 * validate against at all.
 */
export function validateRoster(input: RosterState): { roster: RosterState; rejected: RejectedRecord[] } {
	const roster = rosterStateSchema.parse(input);
	assertGenesis(roster);
	const genesis = roster.genesis.record;

	let revokedAt = new Map<string, string>();
	let admissions = chainAdmissions(roster, revokedAt, null);
	let revocations = validRevocations(roster, admissions, revokedAt);
	for (let pass = 0; pass < MAX_FIXPOINT_PASSES; pass += 1) {
		revokedAt = revocationTimes(revocations);
		const nextAdmissions = chainAdmissions(roster, revokedAt, null);
		const nextRevocations = validRevocations(roster, nextAdmissions, revokedAt);
		const stable = sameKeys(nextAdmissions, admissions) && sameKeys(nextRevocations, revocations);
		admissions = nextAdmissions;
		revocations = nextRevocations;
		if (stable) break;
	}

	const rejected: RejectedRecord[] = [];
	revokedAt = revocationTimes(revocations);
	admissions = chainAdmissions(roster, revokedAt, rejected);

	for (const memberId of Object.keys(roster.revocations).sort()) {
		if (!revocations.has(memberId)) rejected.push({ kind: "revocation", key: memberId, reason: "revoker is not a member, or signature invalid" });
	}

	const members: Record<string, SignedMemberEntry> = {};
	for (const [memberId, signed] of sortedEntries(roster.members)) {
		const reason = memberEntryProblem(signed, memberId, admissions, revocations, genesis.clusterId, genesis.cidr);
		if (reason === null) members[memberId] = signed;
		else rejected.push({ kind: "member", key: memberId, reason });
	}

	const settings: Record<string, SignedSetting> = {};
	for (const [key, signed] of sortedEntries(roster.settings)) {
		const record = signed.record;
		const setter = admissions.get(record.setBy);
		const setterRevokedAt = revokedAt.get(record.setBy);
		const ok =
			setter !== undefined &&
			(setterRevokedAt === undefined || record.setAt < setterRevokedAt) &&
			record.clusterId === genesis.clusterId &&
			record.key === key &&
			verifyPayload(record, signed.signature, setter.record.signingKey);
		if (ok) settings[key] = signed;
		else rejected.push({ kind: "setting", key, reason: "setter is not a member, or signature invalid" });
	}

	return {
		roster: {
			genesis: roster.genesis,
			admissions: Object.fromEntries(admissions),
			members,
			revocations: Object.fromEntries(revocations),
			settings,
		},
		rejected,
	};
}

function memberEntryProblem(
	signed: SignedMemberEntry,
	memberId: string,
	admissions: ReadonlyMap<string, SignedAdmission>,
	revocations: ReadonlyMap<string, SignedRevocation>,
	clusterId: string,
	cidr: string,
): string | null {
	const record = signed.record;
	const admission = admissions.get(memberId);
	if (admission === undefined) return "not admitted";
	if (revocations.has(memberId)) return "revoked";
	if (record.memberId !== memberId || record.clusterId !== clusterId) return "ids do not match";
	if (record.signingKey !== admission.record.signingKey) return "signing key differs from the admitted one";
	if (!verifyPayload(record, signed.signature, record.signingKey)) return "signature invalid";
	if (!cidrContains(cidr, record.address)) return "address outside the cluster CIDR";
	if (deriveMeshAddress(record.wireguardKey, cidr, record.addressSalt) !== record.address) return "address is not derived from its key";
	return null;
}

// ─── Merge ───────────────────────────────────────────────────────────────────

/** Total orders used to pick ONE record per key. Ties fall through to the signature. */
function compareAdmissions(a: SignedAdmission, b: SignedAdmission): number {
	return (
		a.record.admittedAt.localeCompare(b.record.admittedAt) ||
		a.record.admittedBy.localeCompare(b.record.admittedBy) ||
		a.signature.localeCompare(b.signature)
	);
}

function compareMembers(a: SignedMemberEntry, b: SignedMemberEntry): number {
	return a.record.version - b.record.version || a.record.issuedAt.localeCompare(b.record.issuedAt) || a.signature.localeCompare(b.signature);
}

function compareRevocations(a: SignedRevocation, b: SignedRevocation): number {
	return (
		a.record.revokedAt.localeCompare(b.record.revokedAt) ||
		a.record.revokedBy.localeCompare(b.record.revokedBy) ||
		a.signature.localeCompare(b.signature)
	);
}

function compareSettings(a: SignedSetting, b: SignedSetting): number {
	return (
		a.record.version - b.record.version ||
		a.record.setAt.localeCompare(b.record.setAt) ||
		a.record.setBy.localeCompare(b.record.setBy) ||
		a.signature.localeCompare(b.signature)
	);
}

/**
 * Pick one record per key: the FIRST in `order` (min) or the LAST (max), among
 * candidates that pass `admissible`.
 *
 * Candidates are filtered BEFORE they are compared, so a forged record with a
 * winning timestamp cannot shadow a genuine one.
 */
function pick<T>(
	candidates: Record<string, T>[],
	order: (a: T, b: T) => number,
	want: "min" | "max",
	admissible: (key: string, value: T) => boolean,
): Record<string, T> {
	const out: Record<string, T> = {};
	for (const source of candidates) {
		for (const [key, value] of Object.entries(source)) {
			if (!admissible(key, value)) continue;
			const current = out[key];
			if (current === undefined) {
				out[key] = value;
				continue;
			}
			const cmp = order(value, current);
			if ((want === "max" && cmp > 0) || (want === "min" && cmp < 0)) out[key] = value;
		}
	}
	return out;
}

/** Signing keys every admission in the union claims, by member id (self-consistent ones only). */
function claimedSigningKeys(rosters: RosterState[]): Map<string, Set<string>> {
	const keys = new Map<string, Set<string>>();
	for (const roster of rosters) {
		for (const admission of Object.values(roster.admissions)) {
			const { memberId, signingKey } = admission.record;
			if (deriveMemberId(signingKey) !== memberId) continue;
			const set = keys.get(memberId) ?? new Set<string>();
			set.add(signingKey);
			keys.set(memberId, set);
		}
	}
	return keys;
}

function signedByClaimedKey(payload: unknown, signature: string, signer: string, keys: ReadonlyMap<string, Set<string>>): boolean {
	for (const key of keys.get(signer) ?? []) {
		if (verifyPayload(payload, signature, key)) return true;
	}
	return false;
}

/**
 * Merge two copies of the roster.
 *
 * Throws `cluster-mismatch` when they do not share a genesis — two different
 * clusters must never blend, whichever one a misdirected gossip came from.
 */
export function mergeRosters(local: RosterState, incoming: RosterState): RosterState {
	const a = rosterStateSchema.parse(local);
	const b = rosterStateSchema.parse(incoming);
	if (canonicalJson(a.genesis) !== canonicalJson(b.genesis)) {
		throw new RosterError("cluster-mismatch", `roster belongs to cluster ${b.genesis.record.clusterId}, not ${a.genesis.record.clusterId}`);
	}
	const keys = claimedSigningKeys([a, b]);

	const merged: RosterState = {
		genesis: a.genesis,
		admissions: pick([a.admissions, b.admissions], compareAdmissions, "min", (_, adm) =>
			signedByClaimedKey(adm.record, adm.signature, adm.record.admittedBy, keys),
		),
		members: pick([a.members, b.members], compareMembers, "max", (memberId, entry) =>
			entry.record.memberId === memberId &&
			deriveMemberId(entry.record.signingKey) === memberId &&
			verifyPayload(entry.record, entry.signature, entry.record.signingKey),
		),
		revocations: pick([a.revocations, b.revocations], compareRevocations, "min", (_, rev) =>
			signedByClaimedKey(rev.record, rev.signature, rev.record.revokedBy, keys),
		),
		settings: pick([a.settings, b.settings], compareSettings, "max", (_, setting) =>
			signedByClaimedKey(setting.record, setting.signature, setting.record.setBy, keys),
		),
	};
	return validateRoster(merged).roster;
}

// ─── Authoring ───────────────────────────────────────────────────────────────

/** Sign a record with the identity's key and wrap it in the envelope. */
function seal<T>(record: T, identity: MeshIdentity): { record: T; signature: string } {
	return { record, signature: signPayload(record, identity.signingPrivateKey) };
}

export type MemberDescription = {
	name: string;
	kind?: MemberKind;
	endpoints?: EndpointCandidate[];
	labels?: Record<string, string>;
}

function selfEntry(
	identity: MeshIdentity,
	clusterId: string,
	cidr: string,
	description: MemberDescription,
	addressSalt: number,
	issuedAt: string,
): MemberEntry {
	return {
		clusterId,
		memberId: identity.memberId,
		signingKey: identity.signingKey,
		wireguardKey: identity.wireguardKey,
		address: deriveMeshAddress(identity.wireguardKey, cidr, addressSalt),
		addressSalt,
		name: description.name,
		kind: description.kind ?? "node",
		endpoints: description.endpoints ?? [],
		labels: description.labels ?? {},
		version: 1,
		issuedAt,
		state: "active",
	};
}

/** Found a cluster: the genesis record, its self-admission and its first entry. */
export function createGenesis(
	identity: MeshIdentity,
	description: MemberDescription & { cidr?: string; listenPort?: number },
	now?: Date,
): RosterState {
	const createdAt = nowIso(now);
	const cidr = description.cidr ?? DEFAULT_MESH_CIDR;
	parseCidr(cidr);
	const clusterId = deriveClusterId(identity.signingKey);
	const admission: AdmissionRecord = {
		clusterId,
		memberId: identity.memberId,
		signingKey: identity.signingKey,
		admittedBy: identity.memberId,
		admittedAt: createdAt,
	};
	return validateRoster({
		genesis: seal(
			{
				clusterId,
				memberId: identity.memberId,
				signingKey: identity.signingKey,
				cidr,
				listenPort: description.listenPort ?? DEFAULT_MESH_LISTEN_PORT,
				createdAt,
			},
			identity,
		),
		admissions: { [identity.memberId]: seal(admission, identity) },
		members: { [identity.memberId]: seal(selfEntry(identity, clusterId, cidr, description, 0, createdAt), identity) },
		revocations: {},
		settings: {},
	}).roster;
}

/**
 * What a joiner hands to an existing member: its own signed entry for the target
 * cluster. It proves possession of the key (the signature) and states the address
 * every member will verify.
 */
export function createJoinRequest(
	identity: MeshIdentity,
	target: { clusterId: string; cidr: string },
	description: MemberDescription,
	addressSalt = 0,
	now?: Date,
): SignedMemberEntry {
	return seal(selfEntry(identity, target.clusterId, target.cidr, description, addressSalt, nowIso(now)), identity);
}

function requireActiveMember(roster: RosterState, memberId: string): MemberEntry {
	if (roster.revocations[memberId] !== undefined) throw new RosterError("revoked", `${memberId} has been revoked`);
	const entry = roster.members[memberId]?.record;
	if (entry === undefined || roster.admissions[memberId] === undefined) {
		throw new RosterError("not-a-member", `${memberId} is not a member of this cluster`);
	}
	return entry;
}

/**
 * Admit a joiner. Any active member can do this — that is the point.
 *
 * Authorising the HUMAN behind the join (operator login, one-time token) is the
 * caller's job; this function decides only whether the request is admissible to the
 * mesh: same cluster, a key-derived id and address, no address collision, not
 * previously revoked. Re-admitting an existing member is idempotent, so a joiner
 * that crashed after being admitted can simply ask again.
 */
export function admitMember(
	roster: RosterState,
	admitter: MeshIdentity,
	request: SignedMemberEntry,
	now?: Date,
): { roster: RosterState; admission: SignedAdmission } {
	const current = validateRoster(roster).roster;
	requireActiveMember(current, admitter.memberId);

	const parsed = signedMemberEntrySchema.parse(request);
	const entry = parsed.record;
	const genesis = current.genesis.record;
	if (entry.clusterId !== genesis.clusterId) {
		throw new RosterError("cluster-mismatch", `join request targets cluster ${entry.clusterId}`);
	}
	if (deriveMemberId(entry.signingKey) !== entry.memberId) {
		throw new RosterError("member-id-mismatch", "member id is not derived from the signing key");
	}
	if (!verifyPayload(entry, parsed.signature, entry.signingKey)) {
		throw new RosterError("invalid-signature", "join request is not signed by its own key");
	}
	if (current.revocations[entry.memberId] !== undefined) {
		throw new RosterError("revoked", `${entry.memberId} was revoked and cannot rejoin with the same identity`);
	}
	if (!cidrContains(genesis.cidr, entry.address) || deriveMeshAddress(entry.wireguardKey, genesis.cidr, entry.addressSalt) !== entry.address) {
		throw new RosterError("address-mismatch", "address is not derived from the WireGuard key inside the cluster CIDR");
	}
	const collision = activeMembers(current).find((member) => member.address === entry.address && member.memberId !== entry.memberId);
	if (collision !== undefined) {
		throw new RosterError("address-collision", `${entry.address} is already held by ${collision.memberId}; retry with the next salt`);
	}

	const admission =
		current.admissions[entry.memberId] ??
		seal(
			{
				clusterId: genesis.clusterId,
				memberId: entry.memberId,
				signingKey: entry.signingKey,
				admittedBy: admitter.memberId,
				admittedAt: nowIso(now),
			},
			admitter,
		);

	const next = mergeRosters(current, {
		...current,
		admissions: { ...current.admissions, [entry.memberId]: admission },
		members: { ...current.members, [entry.memberId]: parsed },
	});
	return { roster: next, admission };
}

/**
 * Accept the roster an admitter returned, on the joiner's side.
 *
 * Verifies that the roster really admits THIS identity — a joiner must not adopt a
 * cluster it is not part of because a response said so.
 */
export function adoptRoster(identity: MeshIdentity, roster: RosterState): RosterState {
	const { roster: validated } = validateRoster(roster);
	requireActiveMember(validated, identity.memberId);
	if (validated.members[identity.memberId]?.record.signingKey !== identity.signingKey) {
		throw new RosterError("member-id-mismatch", "the roster's entry for this member carries a different key");
	}
	return validated;
}

export type SelfEntryPatch = {
	name?: string;
	endpoints?: EndpointCandidate[];
	labels?: Record<string, string>;
	state?: MemberState;
	addressSalt?: number;
}

/**
 * Publish a new version of the member's own entry.
 *
 * Returns the roster UNCHANGED when the patch changes nothing, so a periodic
 * refresh does not bump the version (and re-gossip the entry) every tick.
 */
export function updateSelfEntry(roster: RosterState, identity: MeshIdentity, patch: SelfEntryPatch, now?: Date): RosterState {
	const current = requireActiveMember(roster, identity.memberId);
	const cidr = roster.genesis.record.cidr;
	const addressSalt = patch.addressSalt ?? current.addressSalt;
	const candidate: MemberEntry = {
		...current,
		name: patch.name ?? current.name,
		endpoints: patch.endpoints ?? current.endpoints,
		labels: patch.labels ?? current.labels,
		state: patch.state ?? current.state,
		addressSalt,
		address: deriveMeshAddress(identity.wireguardKey, cidr, addressSalt),
	};
	if (canonicalJson(candidate) === canonicalJson(current)) return roster;

	const next: MemberEntry = { ...candidate, version: current.version + 1, issuedAt: nowIso(now) };
	return mergeRosters(roster, { ...roster, members: { ...roster.members, [identity.memberId]: seal(next, identity) } });
}

/** Permanently remove a member. Any active member may revoke any member. */
export function revokeMember(roster: RosterState, revoker: MeshIdentity, memberId: string, reason: string, now?: Date): RosterState {
	requireActiveMember(roster, revoker.memberId);
	if (roster.admissions[memberId] === undefined) throw new RosterError("not-a-member", `${memberId} is not a member of this cluster`);
	if (roster.revocations[memberId] !== undefined) return roster;
	const record: RevocationRecord = {
		clusterId: roster.genesis.record.clusterId,
		memberId,
		revokedBy: revoker.memberId,
		revokedAt: nowIso(now),
		reason,
	};
	return mergeRosters(roster, { ...roster, revocations: { ...roster.revocations, [memberId]: seal(record, revoker) } });
}

/** Write a cluster-wide setting. Any active member may write; the highest version wins. */
export function setSetting(roster: RosterState, writer: MeshIdentity, key: string, value: SettingRecord["value"], now?: Date): RosterState {
	requireActiveMember(roster, writer.memberId);
	const current = roster.settings[key]?.record;
	if (current !== undefined && canonicalJson(current.value) === canonicalJson(value)) return roster;
	const record: SettingRecord = {
		clusterId: roster.genesis.record.clusterId,
		key,
		value,
		version: (current?.version ?? 0) + 1,
		setBy: writer.memberId,
		setAt: nowIso(now),
	};
	return mergeRosters(roster, { ...roster, settings: { ...roster.settings, [key]: seal(record, writer) } });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** The value of a setting, or `undefined` when nobody has written it. */
export function getSetting(roster: RosterState, key: string): SettingRecord["value"] | undefined {
	return roster.settings[key]?.record.value;
}

/** Members that are admitted, not revoked, and not departed. Sorted by id. */
export function activeMembers(roster: RosterState): MemberEntry[] {
	return sortedEntries(roster.members)
		.map(([, signed]) => signed.record)
		.filter((entry) => entry.state === "active" && roster.revocations[entry.memberId] === undefined && roster.admissions[entry.memberId] !== undefined);
}

/**
 * Members that must re-derive their address because an earlier-admitted member
 * holds the same one.
 *
 * Deterministic on every member, so the loser knows it lost and every peer agrees
 * which of the two to route to in the meantime.
 */
export function addressConflictLosers(roster: RosterState): Set<string> {
	const byAddress = new Map<string, MemberEntry[]>();
	for (const member of activeMembers(roster)) {
		const group = byAddress.get(member.address) ?? [];
		group.push(member);
		byAddress.set(member.address, group);
	}
	const losers = new Set<string>();
	for (const group of byAddress.values()) {
		if (group.length < 2) continue;
		const ranked = [...group].sort((a, b) => {
			const aAt = roster.admissions[a.memberId]?.record.admittedAt ?? "";
			const bAt = roster.admissions[b.memberId]?.record.admittedAt ?? "";
			return aAt.localeCompare(bAt) || a.memberId.localeCompare(b.memberId);
		});
		for (const loser of ranked.slice(1)) losers.add(loser.memberId);
	}
	return losers;
}
