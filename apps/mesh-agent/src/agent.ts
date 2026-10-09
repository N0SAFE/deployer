/**
 * MeshAgent — one node's member of the mesh.
 *
 * It owns the node's identity, keeps a full copy of the roster, and every tick:
 *
 *   1. refreshes how peers can reach it (LAN, STUN, declared) in its own entry,
 *   2. moves its address if an earlier-admitted member holds the same one,
 *   3. plans and applies the WireGuard peers,
 *   4. converges the node's doors from the replicated `node.doors` setting,
 *   5. gossips its roster to a few members and merges what comes back.
 *
 * Nothing here waits on another member to be the authority for anything: a node
 * that can reach no one keeps its interface, its doors and its roster, and catches
 * up by merging the moment it reaches anyone.
 */

import {
	activeMembers,
	addressConflictLosers,
	admitMember,
	adoptRoster,
	canonicalJson,
	cidrPrefix,
	createGenesis,
	createJoinRequest,
	getSetting,
	mergeRosters,
	NODE_DOORS_SETTING_KEY,
	nodeDoorsSettingSchema,
	planLinks,
	renderWireguardConfig,
	revokeMember,
	RosterError,
	setSetting,
	updateSelfEntry,
	validateRoster,
	type AdmitResponse,
	type AgentDoorView,
	type AgentMemberView,
	type AgentStatus,
	type CreateClusterRequest,
	type EndpointCandidate,
	type JoinRequestRequest,
	type LinkAttempt,
	type MeshIdentity,
	type NodeDoorsSetting,
	type PlannedPeer,
	type RosterState,
	type SettingRecord,
	type SignedMemberEntry,
	type WireguardDump,
} from "@repo/mesh-network";

import type { AgentConfig } from "./config";
import type { DoorConverger } from "./doors/door-converger";
import type { GossipClient } from "./gossip-client";
import type { StateStore } from "./state-store";
import type { WireguardDriver } from "./wireguard-driver";

/** How often the agent re-asks STUN for its public address. */
const REFLEXIVE_REFRESH_MS = 60_000;
/** Members contacted per gossip round. Small and random: epidemic spread does the rest. */
const GOSSIP_FANOUT = 3;

export type AgentErrorCode = "not-in-cluster" | "already-in-cluster" | RosterError["code"];

/** A control-API failure with the HTTP status it maps to. */
export class AgentError extends Error {
	constructor(
		readonly code: AgentErrorCode,
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "AgentError";
	}

	static fromRoster(error: RosterError): AgentError {
		const status = error.code === "not-a-member" ? 404 : error.code === "address-collision" || error.code === "revoked" ? 409 : 400;
		return new AgentError(error.code, status, error.message);
	}
}

export type MeshAgentDeps = {
	config: AgentConfig;
	store: StateStore;
	identity: MeshIdentity;
	roster: RosterState | null;
	wireguard: WireguardDriver;
	gossip: GossipClient;
	doors: DoorConverger | null;
	discoverLan: () => EndpointCandidate[];
	discoverReflexive: () => Promise<string | null>;
	now: () => number;
	random: () => number;
	log: (level: "info" | "warn" | "error", message: string) => void;
}

export class MeshAgent {
	private roster: RosterState | null;
	private attempts: Record<string, LinkAttempt> = {};
	private plan: PlannedPeer[] = [];
	private dump: WireguardDump | null = null;
	private doorViews: AgentDoorView[] = [];
	private reflexive: string | null = null;
	private reflexiveCheckedAt = Number.NEGATIVE_INFINITY;
	private lastGossipAt: string | null = null;
	private lastError: string | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly deps: MeshAgentDeps) {
		this.roster = deps.roster;
	}

	get identity(): MeshIdentity {
		return this.deps.identity;
	}

	/** This member's mesh address, or null before it founded or joined a cluster. */
	meshAddress(): string | null {
		return this.selfEntry()?.address ?? null;
	}

	/** Whether the kernel interface exists (false in observe mode or before the first tick). */
	interfaceUp(): boolean {
		return this.dump !== null;
	}

	/**
	 * Run `task` after every earlier mutation finished.
	 *
	 * The tick and control requests both rewrite the roster; serialising them is what
	 * keeps a control write from being overwritten by a tick that started before it.
	 */
	private exclusive<T>(task: () => T | Promise<T>): Promise<T> {
		const run = this.queue.then(task, task);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private selfEntry() {
		return this.roster?.members[this.identity.memberId]?.record ?? null;
	}

	/**
	 * Whether the current roster is a mesh this member founded ALONE.
	 *
	 * Setup founds a lone mesh on every fresh node — also on one that will join a
	 * fleet, because the API that performs the join needs a node to run on first.
	 * Abandoning that lone mesh for the fleet's loses nothing (it has no other
	 * member), exactly like leaving the lone swarm it founded alongside. A mesh with
	 * ANY other member is never abandoned this way.
	 */
	private holdsLoneSelfFoundedMesh(): boolean {
		const roster = this.roster;
		if (roster === null) return false;
		const others = Object.keys(roster.admissions).filter((memberId) => memberId !== this.identity.memberId);
		return roster.genesis.record.memberId === this.identity.memberId && others.length === 0;
	}

	private requireRoster(): RosterState {
		if (this.roster === null) throw new AgentError("not-in-cluster", 409, "this agent has not founded or joined a cluster");
		return this.roster;
	}

	/** Replace the roster, persisting only when it actually changed. */
	private async commit(next: RosterState): Promise<void> {
		const changed = this.roster === null || canonicalJson(next) !== canonicalJson(this.roster);
		this.roster = next;
		if (changed) await this.deps.store.saveRoster(next);
	}

	private wrapRoster<T>(fn: () => T): T {
		try {
			return fn();
		} catch (error) {
			if (error instanceof RosterError) throw AgentError.fromRoster(error);
			throw error;
		}
	}

	private currentEndpoints(): EndpointCandidate[] {
		const lan = this.deps.discoverLan();
		const declared = this.deps.config.declaredAddresses.map((host): EndpointCandidate => ({ kind: "declared", host, port: this.deps.config.listenPort }));
		const reflexive: EndpointCandidate[] =
			this.reflexive === null ? [] : [{ kind: "reflexive", host: this.reflexive, port: this.deps.config.listenPort }];
		const seen = new Set<string>();
		return [...lan, ...declared, ...reflexive].filter((candidate) => {
			if (seen.has(candidate.host)) return false;
			seen.add(candidate.host);
			return true;
		});
	}

	// ─── Control operations ──────────────────────────────────────────────────

	/** Found a one-member cluster, or report the cluster the agent is already in. */
	ensureCluster(request: CreateClusterRequest): Promise<AgentStatus> {
		return this.exclusive(async () => {
			if (this.roster === null) {
				const roster = this.wrapRoster(() =>
					createGenesis(this.identity, {
						name: request.name ?? this.deps.config.nodeName,
						cidr: request.cidr,
						listenPort: this.deps.config.listenPort,
						endpoints: this.currentEndpoints(),
						labels: request.labels,
					}),
				);
				await this.commit(roster);
				this.deps.log("info", `founded cluster ${roster.genesis.record.clusterId} as ${this.identity.memberId}`);
			}
			return this.status();
		});
	}

	/** Sign this member's request to join `request.clusterId`. */
	createJoinRequest(request: JoinRequestRequest): Promise<SignedMemberEntry> {
		return this.exclusive(() => {
			if (this.roster !== null && this.roster.genesis.record.clusterId !== request.clusterId && !this.holdsLoneSelfFoundedMesh()) {
				throw new AgentError("already-in-cluster", 409, `already a member of ${this.roster.genesis.record.clusterId}`);
			}
			return this.wrapRoster(() =>
				createJoinRequest(
					this.identity,
					{ clusterId: request.clusterId, cidr: request.cidr },
					{ name: request.name ?? this.deps.config.nodeName, endpoints: this.currentEndpoints(), labels: request.labels },
					request.addressSalt ?? 0,
				),
			);
		});
	}

	/** Admit a joiner (the caller already authorised the human behind it). */
	admit(request: SignedMemberEntry): Promise<AdmitResponse> {
		return this.exclusive(async () => {
			const roster = this.requireRoster();
			const result = this.wrapRoster(() => admitMember(roster, this.identity, request));
			await this.commit(result.roster);
			this.deps.log("info", `admitted ${request.record.memberId} (${request.record.name}) at ${request.record.address}`);
			return result;
		});
	}

	/** Adopt the roster an admitter returned. */
	join(roster: RosterState): Promise<AgentStatus> {
		return this.exclusive(async () => {
			const switching = this.roster !== null && this.roster.genesis.record.clusterId !== roster.genesis.record.clusterId;
			if (switching && !this.holdsLoneSelfFoundedMesh()) {
				throw new AgentError("already-in-cluster", 409, `already a member of ${this.roster?.genesis.record.clusterId ?? "?"}`);
			}
			const adopted = this.wrapRoster(() => adoptRoster(this.identity, roster));
			if (switching) {
				this.deps.log("info", `leaving the lone mesh ${this.roster?.genesis.record.clusterId ?? "?"} this node founded, to join ${adopted.genesis.record.clusterId}`);
				this.roster = null;
				this.attempts = {};
			}
			const current = this.roster;
			await this.commit(current === null ? adopted : this.wrapRoster(() => mergeRosters(current, adopted)));
			this.deps.log("info", `joined cluster ${adopted.genesis.record.clusterId}`);
			return this.status();
		});
	}

	writeSetting(key: string, value: SettingRecord["value"]): Promise<void> {
		return this.exclusive(async () => {
			const roster = this.requireRoster();
			await this.commit(this.wrapRoster(() => setSetting(roster, this.identity, key, value)));
		});
	}

	readSettings(): Record<string, SettingRecord["value"]> {
		const roster = this.requireRoster();
		return Object.fromEntries(Object.entries(roster.settings).map(([key, signed]) => [key, signed.record.value]));
	}

	/** Merge labels into this member's entry (other planes publish facts here). */
	setLabels(labels: Record<string, string>): Promise<void> {
		return this.exclusive(async () => {
			const roster = this.requireRoster();
			const current = this.selfEntry()?.labels ?? {};
			await this.commit(this.wrapRoster(() => updateSelfEntry(roster, this.identity, { labels: { ...current, ...labels } })));
		});
	}

	revoke(memberId: string, reason: string): Promise<void> {
		return this.exclusive(async () => {
			const roster = this.requireRoster();
			await this.commit(this.wrapRoster(() => revokeMember(roster, this.identity, memberId, reason)));
		});
	}

	/** Graceful departure: publish `left`, drop the interface. Not a revocation. */
	leave(): Promise<void> {
		return this.exclusive(async () => {
			const roster = this.requireRoster();
			await this.commit(this.wrapRoster(() => updateSelfEntry(roster, this.identity, { state: "left" })));
			await this.gossipRound();
			await this.deps.wireguard.removeInterface();
			this.dump = null;
		});
	}

	/** Merge a peer's roster and hand back ours. A peer from another cluster is refused. */
	receiveGossip(incoming: RosterState): Promise<RosterState> {
		return this.exclusive(async () => {
			const merged = this.wrapRoster(() => mergeRosters(this.requireRoster(), incoming));
			await this.commit(merged);
			return merged;
		});
	}

	// ─── The tick ────────────────────────────────────────────────────────────

	tick(): Promise<void> {
		return this.exclusive(async () => {
			if (this.roster === null) return;
			try {
				await this.refreshSelf();
				await this.applyDataplane();
				await this.convergeDoors();
				await this.gossipRound();
				this.lastError = null;
			} catch (error) {
				this.lastError = error instanceof Error ? error.message : String(error);
				this.deps.log("error", `tick failed: ${this.lastError}`);
			}
		});
	}

	private async refreshSelf(): Promise<void> {
		const now = this.deps.now();
		if (now - this.reflexiveCheckedAt >= REFLEXIVE_REFRESH_MS) {
			this.reflexiveCheckedAt = now;
			this.reflexive = await this.deps.discoverReflexive().catch(() => null);
		}
		let roster = this.requireRoster();
		roster = updateSelfEntry(roster, this.identity, { endpoints: this.currentEndpoints() });

		if (addressConflictLosers(roster).has(this.identity.memberId)) {
			const salt = (roster.members[this.identity.memberId]?.record.addressSalt ?? 0) + 1;
			roster = updateSelfEntry(roster, this.identity, { addressSalt: salt });
			this.deps.log("warn", `address collision — moving to ${roster.members[this.identity.memberId]?.record.address ?? "?"} (salt ${String(salt)})`);
		}
		await this.commit(roster);
	}

	private async applyDataplane(): Promise<void> {
		const roster = this.requireRoster();
		const self = this.selfEntry();
		if (self?.state !== "active") return;

		await this.deps.wireguard.ensureInterface(self.address, cidrPrefix(roster.genesis.record.cidr));
		this.dump = await this.deps.wireguard.dump();

		const losers = addressConflictLosers(roster);
		const peers = activeMembers(roster).filter((member) => member.memberId !== self.memberId && !losers.has(member.memberId));
		const observations = Object.fromEntries(
			peers.map((peer) => {
				const status = this.dump?.peers[peer.wireguardKey];
				return [peer.memberId, status === undefined ? undefined : { endpoint: status.endpoint, latestHandshakeAt: status.latestHandshakeAt }];
			}),
		);
		const linkPlan = planLinks({ self, peers, observations, attempts: this.attempts, now: this.deps.now() });
		this.attempts = linkPlan.attempts;
		this.plan = linkPlan.peers;

		await this.deps.wireguard.syncConfig(
			renderWireguardConfig({ privateKey: this.identity.wireguardPrivateKey, listenPort: roster.genesis.record.listenPort, peers: linkPlan.peers }),
		);
	}

	private doorsSetting(): NodeDoorsSetting | null {
		const raw = this.roster === null ? undefined : getSetting(this.roster, NODE_DOORS_SETTING_KEY);
		if (raw === undefined) return null;
		const parsed = nodeDoorsSettingSchema.safeParse(raw);
		if (!parsed.success) {
			this.deps.log("warn", `ignoring malformed ${NODE_DOORS_SETTING_KEY} setting: ${parsed.error.message}`);
			return null;
		}
		return parsed.data;
	}

	private async convergeDoors(): Promise<void> {
		if (this.deps.doors === null) return;
		// The private door binds the mesh address, which only exists once the
		// kernel interface carries it.
		this.doorViews = await this.deps.doors.converge(
			this.doorsSetting(),
			this.interfaceUp() ? this.meshAddress() : null,
			this.lanAddress(),
		);
	}

	/**
	 * One LAN address to bind the LAN door on, or null when the node has none.
	 *
	 * A door binds exactly ONE address, so a multi-homed node has to pick: the
	 * first discovered interface wins (sorted, so the choice is stable across
	 * ticks — a door that moved interfaces every tick would be recreated forever).
	 * The full set still travels as endpoint candidates, so peers can reach the
	 * node on any of them; only the joiner-facing door is pinned to one.
	 */
	private lanAddress(): string | null {
		return this.deps.discoverLan()[0]?.host ?? null;
	}

	/** Push the roster to up to GOSSIP_FANOUT random members and merge their replies. */
	private async gossipRound(): Promise<void> {
		const roster = this.requireRoster();
		const reachable = new Set(this.plan.filter((peer) => peer.path === "direct").map((peer) => peer.memberId));
		const candidates = activeMembers(roster).filter((member) => member.memberId !== this.identity.memberId && reachable.has(member.memberId));
		const chosen = [...candidates].sort(() => this.deps.random() - 0.5).slice(0, GOSSIP_FANOUT);

		for (const peer of chosen) {
			const reply = await this.deps.gossip(peer.address, this.deps.config.gossipPort, this.requireRoster());
			if (reply === null) continue;
			try {
				await this.commit(mergeRosters(this.requireRoster(), reply));
				this.lastGossipAt = new Date(this.deps.now()).toISOString();
			} catch (error) {
				this.deps.log("warn", `gossip reply from ${peer.memberId} rejected: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}

	// ─── Status ──────────────────────────────────────────────────────────────

	status(): AgentStatus {
		const roster = this.roster;
		const self = this.selfEntry();
		const members: AgentMemberView[] =
			roster === null
				? []
				: Object.values(validateRoster(roster).roster.members).map(({ record }) => {
						const planned = this.plan.find((peer) => peer.memberId === record.memberId);
						const observed = this.dump?.peers[record.wireguardKey];
						return {
							memberId: record.memberId,
							name: record.name,
							kind: record.kind,
							address: record.address,
							state: record.state,
							endpoints: record.endpoints,
							labels: record.labels,
							link: {
								path: record.memberId === this.identity.memberId ? "self" : (planned?.path ?? "passive"),
								endpoint: observed?.endpoint ?? planned?.endpoint ?? null,
								latestHandshakeAt: observed?.latestHandshakeAt === null || observed === undefined ? null : new Date(observed.latestHandshakeAt).toISOString(),
							},
						};
					});

		return {
			memberId: this.identity.memberId,
			signingKey: this.identity.signingKey,
			wireguardKey: this.identity.wireguardKey,
			cluster:
				roster === null || self === null
					? null
					: {
							clusterId: roster.genesis.record.clusterId,
							cidr: roster.genesis.record.cidr,
							listenPort: roster.genesis.record.listenPort,
							address: self.address,
							interfaceUp: this.interfaceUp(),
						},
			members,
			settingKeys: roster === null ? [] : Object.keys(roster.settings).sort(),
			doors: this.doorViews,
			lastGossipAt: this.lastGossipAt,
			lastError: this.lastError,
		};
	}
}
