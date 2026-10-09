/**
 * Wire schemas for everything members exchange.
 *
 * Every record has the same envelope — `{ record, signature }` — and every field a
 * record is trusted for is INSIDE `record`, the signed part. Anything that arrives
 * from a peer is parsed with these schemas before it is merged; a record that does
 * not parse is dropped, it never reaches the signature check.
 */

import z from "zod/v4";

import { isIpv4 } from "./address";

const ipv4Schema = z.string().refine(isIpv4, { message: "must be an IPv4 address" });
const base64KeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "must be a base64 32-byte key");
const memberIdSchema = z.string().regex(/^m[0-9a-f]{24}$/, "must be a member id");
const clusterIdSchema = z.string().regex(/^c[0-9a-f]{24}$/, "must be a cluster id");
const isoTimestampSchema = z.iso.datetime();
const signatureSchema = z.string().min(1).max(256);

/**
 * How a peer might be reached.
 *
 *   lan        an address on one of the member's own interfaces
 *   reflexive  the member's public address as seen by a STUN server — reachable
 *              only through a NAT mapping both sides open by sending first
 *   declared   an address the operator states is reachable (a `direct` node)
 */
export const endpointCandidateKindSchema = z.enum(["lan", "reflexive", "declared"]);
export type EndpointCandidateKind = z.output<typeof endpointCandidateKindSchema>;

export const endpointCandidateSchema = z.object({
	kind: endpointCandidateKindSchema,
	host: ipv4Schema,
	port: z.number().int().min(1).max(65_535),
});
export type EndpointCandidate = z.output<typeof endpointCandidateSchema>;

/**
 * What a member is.
 *
 *   node      a deployer node — runs Swarm, schedules workloads, serves doors
 *   operator  an operator's machine joined through the CLI — reaches the private
 *             lane, schedules nothing
 */
export const memberKindSchema = z.enum(["node", "operator"]);
export type MemberKind = z.output<typeof memberKindSchema>;

/** `left` is a graceful departure: not revoked, may come back with a newer version. */
export const memberStateSchema = z.enum(["active", "left"]);
export type MemberState = z.output<typeof memberStateSchema>;

/** A member's self-description. Signed by the member itself. */
export const memberEntrySchema = z.object({
	clusterId: clusterIdSchema,
	memberId: memberIdSchema,
	signingKey: base64KeySchema,
	wireguardKey: base64KeySchema,
	address: ipv4Schema,
	addressSalt: z.number().int().min(0).max(1_000),
	name: z.string().min(1).max(253),
	kind: memberKindSchema,
	endpoints: z.array(endpointCandidateSchema).max(32),
	/** Free-form facts other planes attach (swarm node id, platform node id). */
	labels: z.record(z.string().max(128), z.string().max(512)),
	/** Monotonic per member; the highest wins a merge. */
	version: z.number().int().min(1),
	issuedAt: isoTimestampSchema,
	state: memberStateSchema,
});
export type MemberEntry = z.output<typeof memberEntrySchema>;

/** The founding record. Fixes the cluster id and the address space for good. */
export const genesisRecordSchema = z.object({
	clusterId: clusterIdSchema,
	memberId: memberIdSchema,
	signingKey: base64KeySchema,
	cidr: z.string().min(9).max(18),
	listenPort: z.number().int().min(1).max(65_535),
	createdAt: isoTimestampSchema,
});
export type GenesisRecord = z.output<typeof genesisRecordSchema>;

/** "`admittedBy` vouches that `signingKey` is a member." Signed by the admitter. */
export const admissionRecordSchema = z.object({
	clusterId: clusterIdSchema,
	memberId: memberIdSchema,
	signingKey: base64KeySchema,
	admittedBy: memberIdSchema,
	admittedAt: isoTimestampSchema,
});
export type AdmissionRecord = z.output<typeof admissionRecordSchema>;

/** Permanent removal. Signed by any member. A revoked identity never returns. */
export const revocationRecordSchema = z.object({
	clusterId: clusterIdSchema,
	memberId: memberIdSchema,
	revokedBy: memberIdSchema,
	revokedAt: isoTimestampSchema,
	reason: z.string().max(512),
});
export type RevocationRecord = z.output<typeof revocationRecordSchema>;

/** A cluster-wide setting. Last writer (by version) wins. Signed by any member. */
export const settingRecordSchema = z.object({
	clusterId: clusterIdSchema,
	key: z.string().min(1).max(128),
	value: z.json(),
	version: z.number().int().min(1),
	setBy: memberIdSchema,
	setAt: isoTimestampSchema,
});
export type SettingRecord = z.output<typeof settingRecordSchema>;

function signed<T extends z.ZodType>(record: T) {
	return z.object({ record, signature: signatureSchema });
}

export const signedGenesisSchema = signed(genesisRecordSchema);
export type SignedGenesis = z.output<typeof signedGenesisSchema>;
export const signedMemberEntrySchema = signed(memberEntrySchema);
export type SignedMemberEntry = z.output<typeof signedMemberEntrySchema>;
export const signedAdmissionSchema = signed(admissionRecordSchema);
export type SignedAdmission = z.output<typeof signedAdmissionSchema>;
export const signedRevocationSchema = signed(revocationRecordSchema);
export type SignedRevocation = z.output<typeof signedRevocationSchema>;
export const signedSettingSchema = signed(settingRecordSchema);
export type SignedSetting = z.output<typeof signedSettingSchema>;

/**
 * The whole replicated state. Every member holds a full copy.
 *
 * Maps are keyed by member id (or setting key) so a merge is a per-key choice —
 * which is what makes it order-independent.
 */
export const rosterStateSchema = z.object({
	genesis: signedGenesisSchema,
	admissions: z.record(memberIdSchema, signedAdmissionSchema),
	members: z.record(memberIdSchema, signedMemberEntrySchema),
	revocations: z.record(memberIdSchema, signedRevocationSchema),
	settings: z.record(z.string().min(1).max(128), signedSettingSchema),
});
export type RosterState = z.output<typeof rosterStateSchema>;
