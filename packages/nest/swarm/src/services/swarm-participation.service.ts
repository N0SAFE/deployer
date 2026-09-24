/**
 * SwarmParticipationService — the swarm DECISION layer.
 *
 * Responsibility: how THIS node participates in the Swarm cluster, decided at
 * setup time (wizard) and editable later (cluster config UI). It owns:
 *
 *  - the effective participation config (env defaults → persisted node_config
 *    → resolved defaults) for mode/policy/advertise/join,
 *  - the converge step: create (init a new cluster) vs join (existing
 *    cluster) vs disabled — plus the POLICY application on the local node
 *    (auto = mixed manager+worker, manager = dedicated+drained master,
 *    worker = pure worker),
 *  - the read-model `view()` the UI renders (engine state, role,
 *    availability, join tokens, policy documents).
 *
 * Policy → engine mapping (dockerode, no CLI):
 *   auto    → Role=manager, Availability=active   (mixed: holds quorum AND runs
 *             workloads — the recommended 2-3 node setup)
 *   manager → Role=manager, Availability=drain    (dedicated master: no tasks)
 *   worker  → Role=worker,  Availability=active   (pure worker; join only)
 *
 * The local engine is tagged with `deployer.ingress=true` when this node is
 * a manager so node-local (global) platform services can place on it.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import {
    swarmConfigViewSchema,
    swarmParticipationIssues,
    swarmPolicyDocumentSchema,
    swarmParticipationInputSchema,
    swarmParticipationSchema,
    type ClusterSnapshot,
    type SwarmInitOptions,
    type SwarmParticipationConfig,
    type SwarmParticipationInput,
    type SwarmConfigView,
} from "@repo/contracts-entities";
import { SWARM_PARTICIPATION_DEFAULTS, type SwarmParticipationDefaults } from "../swarm-config";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import { ClusterNodeRepository } from "@repo/nest-nodes/cluster-node.repository";
import { SwarmClusterService } from "./swarm-cluster.service";
import { platformRoleForPolicy, withIngress, withPlatformRole } from "@repo/nest-nodes/swarm-node-labels";

const POLICY_DOCUMENTS = [
    swarmPolicyDocumentSchema.parse({
        policy: "auto",
        name: "Mixed — master & worker",
        description:
            "This node is a swarm manager AND keeps running workloads. Every server pulls its weight: small clusters (2–3 nodes) get quorum + capacity without a dedicated control plane.",
        bestFor: "Small fleets (2–3 nodes), dev, single-node",
        role: "manager",
        schedulesWorkloads: true,
        recommended: true,
    }),
    swarmPolicyDocumentSchema.parse({
        policy: "manager",
        name: "Dedicated master",
        description:
            "This node is a swarm manager that does NOT run workload tasks (drained). It is reserved for the control plane — the right choice in larger fleets with a dedicated controller.",
        bestFor: "Large fleets, dedicated control node",
        role: "manager",
        schedulesWorkloads: false,
        recommended: false,
    }),
    swarmPolicyDocumentSchema.parse({
        policy: "worker",
        name: "Worker only",
        description:
            "This node only runs workloads. Control-plane duties live on other managers. Only meaningful when joining an existing cluster (the founding node is always a manager).",
        bestFor: "Adding capacity to an existing cluster",
        role: "worker",
        schedulesWorkloads: true,
        recommended: false,
    }),
] as const;

@Injectable()
export class SwarmParticipationService {
    private readonly logger = new Logger(SwarmParticipationService.name);

    constructor(
        /**
         * First-run defaults supplied as DATA by the app.
         *
         * The persisted `node_config.swarmConfig` always wins; these are only
         * consulted before the wizard has recorded a decision. They arrive as a
         * plain object rather than through an env service because which
         * variables carry them is an app convention — the package must not
         * import one app's environment contract.
         */
        @Inject(SWARM_PARTICIPATION_DEFAULTS)
        private readonly defaults: SwarmParticipationDefaults,
        private readonly nodeConfigRepository: NodeConfigRepository,
        private readonly clusterService: SwarmClusterService,
        private readonly dockerService: DockerService,
        private readonly clusterNodeRepository: ClusterNodeRepository,
    ) {}

    // ─── Configuration resolve ────────────────────────────────────────────────

    /**
     * Effective participation config. Priority: persisted node_config choice
     * (setup wizard / cluster UI) → first-run defaults → schema defaults.
     */
    effectiveConfig(): SwarmParticipationConfig {
        const persisted = this.nodeConfigRepository.find()?.swarmConfig ?? null;
        const defaults = this.defaults;

        return swarmParticipationSchema.parse({
            mode: persisted?.mode ?? defaults.mode ?? "create",
            policy: persisted?.policy ?? defaults.policy ?? "auto",
            advertiseAddr: persisted?.advertiseAddr ?? defaults.advertiseAddr ?? null,
            joinToken: persisted?.joinToken ?? defaults.joinToken ?? null,
            joinAddrs:
                persisted && persisted.joinAddrs.length > 0
                    ? persisted.joinAddrs
                    : (defaults.joinAddrs ?? []),
        });
    }

    /** True once setup completed (the swarm decision is made at setup). */
    setupDone(): boolean {
        const config = this.nodeConfigRepository.find();
        return config?.setupState === "setup_done" && Boolean(config.configuredAt);
    }

    // ─── Converge ────────────────────────────────────────────────────────────

    /**
     * Converge the local engine according to the participation config, then
     * apply the node policy. Idempotent: when the engine is already active it
     * only re-applies the policy + persists the snapshot.
     *
     * Branching is EXHAUSTIVE and never degrades one mode into another:
     *   - already active   → policy only (never tear a live cluster down)
     *   - join             → join the cluster; a missing token/address is a
     *                        LOUD failure, never a silent `swarm init`
     *   - create           → found a new cluster
     */
    async converge(): Promise<ClusterSnapshot> {
        const cfg = this.effectiveConfig();
        const info = await this.dockerService.getSwarmInfo();

        if (info.LocalNodeState === "active") {
            // A node that was told to JOIN must never stay in a cluster it
            // FOUNDED itself. Boot converges the engine before setup (so the
            // platform supervisors have a swarm to schedule onto), which means
            // a fresh node already owns a lone one-node cluster by the time the
            // wizard records `mode=join`. Leaving is safe ONLY for that lone
            // auto-founded cluster: a single manager and a single node is by
            // construction this node's own — no peer state can be lost.
            if (cfg.mode === "join" && (await this.isLoneAutoFoundedCluster())) {
                this.logger.warn(
                    "Swarm participation switched to 'join' — leaving the lone auto-founded cluster before joining the target one",
                );
                await this.dockerService.swarmLeave(true);
            } else {
                const snapshot = await this.clusterService.getLocalClusterSnapshot();
                await this.applyPolicy(snapshot, this.policyFor(cfg, snapshot));
                await this.persistSnapshot(snapshot);
                return snapshot;
            }
        }

        const snapshot =
            cfg.mode === "join" ? await this.joinExisting(cfg) : await this.createNew(cfg);

        await this.applyPolicy(snapshot, this.policyFor(cfg, snapshot));
        await this.persistSnapshot(snapshot);
        return snapshot;
    }

    /**
     * True when the active cluster is a LONE node the platform auto-founded at
     * boot (one node, one manager) — i.e. nothing but this node's own default
     * cluster, safe to leave when the operator actually wants to join a fleet.
     */
    private async isLoneAutoFoundedCluster(): Promise<boolean> {
        const snapshot = await this.clusterService.getLocalClusterSnapshot();
        return snapshot.nodeCount <= 1 && snapshot.managerCount <= 1;
    }

    /**
     * Policy actually applied to the local node, defending the two invariants
     * even for legacy/env-derived configs (the input schemas already reject
     * them for fresh input):
     *   - a node that FOUNDED the cluster is its only manager → `worker` would
     *     leave the swarm with no manager at all, so it is clamped to `auto`;
     *   - a cluster whose ONLY manager is this node can never be drained.
     */
    private policyFor(
        cfg: SwarmParticipationConfig,
        snapshot: ClusterSnapshot,
    ): SwarmParticipationConfig["policy"] {
        if (cfg.mode === "create" && cfg.policy === "worker") {
            this.logger.warn(
                "Swarm policy 'worker' is impossible for a founding node (it would leave the new cluster with no manager) — using 'auto' instead",
            );
            return "auto";
        }
        if (cfg.policy === "manager" && snapshot.managerCount <= 1) {
            this.logger.warn(
                `Swarm policy 'manager' (dedicated, drained) is impossible while this node is the only manager (managers=${String(snapshot.managerCount)}) — using 'auto' instead`,
            );
            return "auto";
        }
        return cfg.policy;
    }

    private async createNew(cfg: SwarmParticipationConfig): Promise<ClusterSnapshot> {
        this.logger.log(`Swarm participation: creating a new cluster (policy=${cfg.policy})`);
        const options = this.initOptions(cfg);
        return await this.clusterService.ensureCluster(options);
    }

    private async joinExisting(cfg: SwarmParticipationConfig): Promise<ClusterSnapshot> {
        this.logger.log(
            `Swarm participation: joining existing cluster at ${cfg.joinAddrs.join(", ") || "configured addrs"} (policy=${cfg.policy})`,
        );
        // Both are REQUIRED and there is deliberately no fallback to `create`:
        // a node told to join must never silently found a second, unrelated
        // swarm (that produced two competing clusters with one config).
        if (cfg.joinAddrs.length === 0) {
            throw new Error(
                "Swarm participation mode=join requires at least one control-plane address (joinAddrs)",
            );
        }
        if (!cfg.joinToken) {
            throw new Error(
                "Swarm participation mode=join requires the cluster's join token — get it from the founding node (Cluster page) and set it here",
            );
        }
        await this.clusterService.joinCluster({
            joinToken: cfg.joinToken,
            remoteAddrs: cfg.joinAddrs,
        });
        // A join is acknowledged immediately but only becomes USABLE once the
        // Raft join settles — wait for the engine to report `active`.
        return await this.clusterService.waitForActiveCluster();
    }

    /** Deterministic init options (ListenAddr + concrete AdvertiseAddr). */
    private initOptions(cfg: SwarmParticipationConfig): SwarmInitOptions {
        const options: SwarmInitOptions = { ListenAddr: "0.0.0.0:2377" };
        const advertise =
            cfg.advertiseAddr ?? this.defaults.advertiseAddr ?? this.defaults.overlayIp;
        options.AdvertiseAddr = `${advertise ?? "127.0.0.1"}:2377`;
        return options;
    }

    /**
     * Apply the node policy: role (manager/worker) + availability (active for
     * mixed/worker, drain for dedicated master) + ingress label on managers.
     */
    private async applyPolicy(snapshot: ClusterSnapshot, policy: SwarmParticipationConfig["policy"]): Promise<void> {
        const engineNodeId = snapshot.localNode.nodeId;
        if (engineNodeId === "unknown" || engineNodeId === "") {
            this.logger.warn("Cannot apply swarm policy — local engine node id unknown");
            return;
        }

        const desired =
            policy === "worker"
                ? { role: "worker" as const, availability: "active" as const }
                : policy === "manager"
                    ? { role: "manager" as const, availability: "drain" as const }
                    : { role: "manager" as const, availability: "active" as const };

        try {
            const node = await this.dockerService.inspectSwarmNode(engineNodeId);
            // Shared resolver: never guess a manager as a worker.
            const currentRole = DockerService.resolveSwarmNodeRole(node);
            const currentAvail = node.Spec?.Availability ?? "active";
            const effectiveAvail: "active" | "pause" | "drain" =
                currentAvail === "pause" || currentAvail === "drain" ? currentAvail : "active";

            const roleChanged = currentRole !== desired.role;
            const availChanged = effectiveAvail !== desired.availability;

            let version = node.Version.Index;
            if (roleChanged || availChanged) {
                await this.dockerService.updateSwarmNodeRoleAvailability(engineNodeId, version, {
                    role: desired.role,
                    availability: desired.availability,
                });
                this.logger.log(
                    `Applied swarm policy ${policy}: role=${desired.role}, availability=${desired.availability}${
                        roleChanged ? " (promoted/demoted)" : ""
                    }${availChanged ? " (drained/undrained)" : ""} — node ${engineNodeId}`,
                );
                // Node updates are version-guarded: the update above bumped the
                // spec version, so a second update MUST use the fresh index
                // (reusing the stale one fails with "update out of sequence").
                version = (await this.dockerService.inspectSwarmNode(engineNodeId)).Version.Index;
            }

            // Platform role + ingress label: the DURABLE record of this node's
            // configuration (the local inventory is only a cache). Managers run
            // the node-local platform services, so they carry the ingress label.
            const currentLabels = node.Spec?.Labels ?? {};
            const wantsIngress = desired.role === "manager";
            const desiredPlatformRole = platformRoleForPolicy(policy);
            const labels = withIngress(
                withPlatformRole(currentLabels, desiredPlatformRole),
                wantsIngress ? true : null,
            );
            if (JSON.stringify(labels) !== JSON.stringify(currentLabels)) {
                await this.dockerService.updateSwarmNodeLabels(engineNodeId, version, labels);
            }
        } catch (error: unknown) {
            // A freshly-joined worker has no manager rights to promote itself —
            // the error is benign when role/availability are already right.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Swarm policy application skipped: ${message}`);
        }
    }

    private async persistSnapshot(snapshot: ClusterSnapshot): Promise<void> {
        try {
            const row = this.clusterNodeRepository.upsertFromSnapshot(snapshot);
            this.logger.log(`Cluster node state persisted (swarmRole=${row.swarmRole ?? "n/a"})`);
        } catch (error: unknown) {
            this.logger.warn(
                `Cluster node state persistence skipped: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    // ─── Persist a config change ─────────────────────────────────────────────

    /**
     * Persist a participation change (setup wizard / cluster config UI) and
     * converge immediately when the platform is already set up.
     */
    async applyConfig(input: SwarmParticipationInput): Promise<SwarmConfigView> {
        const parsed = swarmParticipationInputSchema.parse(input ?? {});
        const current = this.effectiveConfig();
        const merged = swarmParticipationSchema.parse({
            mode: parsed.mode ?? current.mode,
            policy: parsed.policy ?? current.policy,
            advertiseAddr: parsed.advertiseAddr ?? current.advertiseAddr,
            joinToken: parsed.joinToken ?? current.joinToken,
            joinAddrs: parsed.joinAddrs && parsed.joinAddrs.length > 0 ? parsed.joinAddrs : current.joinAddrs,
        });

        // The MERGED config is what actually gets persisted/converged, so the
        // coherence invariants are enforced here (the partial input alone
        // cannot express e.g. "create + worker" when only one field is sent).
        const issues = swarmParticipationIssues(merged);
        if (issues.length > 0) {
            throw new Error(issues.map((issue) => issue.message).join(" "));
        }

        const existing = this.nodeConfigRepository.find();
        this.nodeConfigRepository.upsert({
            ...(existing ?? { nodeId: "pending", strategy: "local" as const, updatedAt: new Date().toISOString(), setupState: "not_started" as const }),
            swarmConfig: merged,
        });

        if (this.setupDone()) {
            try {
                await this.converge();
            } catch (error: unknown) {
                this.logger.warn(
                    `Swarm convergence after config change failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        } else {
            this.logger.log("Swarm config persisted — convergence deferred until setup completes");
        }

        return await this.view();
    }

    /** The read-model the UI renders. */
    async view(): Promise<SwarmConfigView> {
        const cfg = this.effectiveConfig();
        const info = await this.dockerService.getSwarmInfo().catch(() => null);
        const active = info?.LocalNodeState === "active";
        let role = "none";
        let availability = "";
        let nodeCount = 0;
        let managerCount = 0;
        let joinTokens: { worker: string; manager: string } | null = null;

        if (active) {
            const snapshot = await this.clusterService.getLocalClusterSnapshot().catch(() => null);
            role = snapshot?.localNode.swarmRole ?? "none";
            availability = snapshot?.localNode.availability ?? "active";
            nodeCount = snapshot?.nodeCount ?? 0;
            managerCount = snapshot?.managerCount ?? 0;
            joinTokens = (await this.clusterService.getJoinTokens().catch(() => null)) ?? null;
        }

        return swarmConfigViewSchema.parse({
            participation: cfg,
            setupDone: this.setupDone(),
            engineState: info?.LocalNodeState ?? "unknown",
            role,
            availability,
            nodeCount,
            managerCount,
            joinTokens,
            resolveNote: this.resolveNote(cfg, active, role),
            policies: POLICY_DOCUMENTS,
        });
    }

    private resolveNote(cfg: SwarmParticipationConfig, active: boolean, role: string): string {
        if (!this.setupDone()) {
            return "Setup is not complete — the swarm decision is made during setup. Until then, platforms services are not scheduled on this node.";
        }
        if (!active) {
            return "Setup complete, but the engine is not swarm-active yet. Convergence runs on boot — or trigger it from this panel.";
        }
        const policyLabel =
            cfg.policy === "auto"
                ? "mixed master + worker"
                : cfg.policy === "manager"
                    ? "dedicated master (drained)"
                    : "worker";
        return `Engine active — this node is a ${roleNoun(role, cfg)} (${policyLabel}).`;
    }
}

function roleNoun(role: string, cfg: SwarmParticipationConfig): string {
    if (cfg.policy === "worker" || role === "worker") return "worker";
    return role === "manager" ? "manager" : "node";
}
