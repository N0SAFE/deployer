import { Inject, Injectable, type OnModuleDestroy, Logger } from "@nestjs/common";
  import { createHash } from "node:crypto";
  import {
      meshNodeStateSchema,
      meshPeerConnectionSchema,
      type MeshNodeState,
      type MeshPeerConnection,
  } from "@repo/contracts-entities";
  import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
  import { ID_GENERATOR_TOKEN, type IdGenerator } from "../../../shared/primitives/id-generator";
  import { MeshIdentityService } from "../services/mesh-identity.service";
  import { MeshMembershipService } from "../services/mesh-membership.service";
  import { MeshPeerSessionService } from "../services/mesh-peer-session.service";
  import { MeshHealthMonitorService } from "../services/mesh-health-monitor.service";
  import { SystemMeshClusterRepository } from "../../../repositories/system-mesh-cluster.repository";
  import { SystemMeshLogicService } from "../../system-mesh-logic.service";
  import { SystemMeshConfigService } from "../../system-mesh-config.service";

  interface ClusterSyncNodeRecord {
      nodeId: string;
      serverUrl: string;
      status: "active" | "suspect" | "draining" | "revoked";
      healthy: boolean;
      lastSeenAt: string | null;
  }

  /**
   * Synchronisation périodique depuis la base de données du cluster.
   *
   * Responsabilités :
   *  - Hydratation au démarrage (nœuds, clés de signature, ressources)
   *  - Sync périodique des peers actifs
   *  - Inférence de topologie O(N·log N) via fanout borné
   *
   * Le fanout est calculé dynamiquement : ⌈log₂(N+1)⌉ peers par nœud,
   * borné par MESH_PEER_MAX si configuré.
   */
  @Injectable()
  export class MeshClusterSyncService implements OnModuleDestroy {
      private readonly logger = new Logger(MeshClusterSyncService.name);
      private bootstrapAttempted = false;
      private syncTimer: ReturnType<typeof setInterval> | null = null;

      constructor(
          @Inject(CLOCK_TOKEN) private readonly clock: Clock,
          @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
          private readonly identity: MeshIdentityService,
          private readonly membership: MeshMembershipService,
          private readonly sessions: MeshPeerSessionService,
          private readonly health: MeshHealthMonitorService,
          private readonly meshLogic: SystemMeshLogicService,
          private readonly meshConfigService: SystemMeshConfigService,
          private readonly clusterRepository?: SystemMeshClusterRepository,
      ) {}

      async registerLocalNodeOnStartup(): Promise<void> {
          if (this.bootstrapAttempted) return;
          this.bootstrapAttempted = true;
          if (!this.clusterRepository || !("registerOrUpdateNode" in this.clusterRepository)) return;

          try {
              await this.clusterRepository.registerOrUpdateNode({
                  nodeId: this.identity.getNodeId(),
                  serverUrl: this.identity.resolveLocalServerUrl(),
                  metadata: { source: "startup-registration" },
              });
          } catch (error) {
              this.logger.warn(`Local node startup registration failed: ${this.errMsg(error)}`);
          }
      }

      startPeriodicSync(
          onTick: () => void,
      ): void {
          const intervalMs = this.meshConfigService.getSyncIntervalMs();
          if (this.syncTimer) clearInterval(this.syncTimer);
          this.syncTimer = setInterval(() => {
              void this.syncPeers("interval");
              onTick();
          }, intervalMs);
      }

      stopPeriodicSync(): void {
          if (this.syncTimer) {
              clearInterval(this.syncTimer);
              this.syncTimer = null;
          }
      }

      /**
       * NestJS lifecycle hook — ensures the periodic peer-sync timer is
       * stopped so the API process can exit cleanly. Idempotent and
       * safe to call when no timer is currently scheduled.
       */
      onModuleDestroy(): void {
          this.stopPeriodicSync();
      }

      async syncPeers(reason: "startup" | "interval"): Promise<void> {
          if (!this.clusterRepository || !("loadActiveClusterNodes" in this.clusterRepository)) return;

          try {
              const nodes = (await this.clusterRepository.loadActiveClusterNodes()) as ClusterSyncNodeRecord[];
              const nowIso = this.clock.nowIso();
              let synced = 0;

              for (const node of nodes) {
                  if (node.nodeId === this.identity.getNodeId() || node.status === "revoked") continue;

                  this.upsertRemoteNodeFromRecord(node, nowIso);

                  const endpointUrl = this.toMeshEndpointUrl(node.serverUrl);
                  const existing = this.sessions.getActiveByEndpointUrl(endpointUrl);

                  if (!existing || existing.state === "closed") {
                      const connected = this.sessions.connect({
                          endpointUrl,
                          serverUrl: node.serverUrl,
                          metadata: { bootstrap: true, source: "cluster_nodes", syncReason: reason },
                      });
                      this.health.heartbeat(connected.session.sessionId, {
                          peerNodeId: node.nodeId,
                          latencyMs: 40,
                          jitterMs: 8,
                          packetLossRatio: node.healthy ? 0.002 : 0.35,
                          throughputMbps: node.healthy ? 800 : 50,
                          reliabilityScore: node.healthy ? 0.995 : 0.6,
                      });
                      synced += 1;
                      continue;
                  }

                  this.health.heartbeat(existing.sessionId, {
                      peerNodeId: node.nodeId,
                      latencyMs: this.baselineLatency(existing.sessionId, node),
                      jitterMs: this.baselineJitter(existing.sessionId, node),
                      packetLossRatio: this.baselinePacketLoss(existing.sessionId, node),
                      throughputMbps: this.baselineThroughput(existing.sessionId, node),
                      reliabilityScore: this.baselineReliability(existing.sessionId, node),
                  });
                  synced += 1;
              }

              const inferredLinks = this.refreshInferredTopology(nodes, reason, nowIso);

              if (synced > 0 || inferredLinks > 0) {
                  this.logger.log(
                      `Mesh DB sync (${reason}): ${String(synced)} peer(s) reconciled, ${String(inferredLinks)} inferred link(s)`,
                  );
              }
          } catch (error) {
              this.logger.warn(`Mesh DB sync (${reason}) failed: ${this.errMsg(error)}`);
          }
      }

      // ─── Inférence de topologie ───────────────────────────────────────────────

      /**
       * Reconstruit les edges inférés depuis les nœuds connus du cluster.
       * Complexité : O(N · fanout) = O(N · log N) grâce au fanout borné.
       */
      private refreshInferredTopology(
          nodes: ClusterSyncNodeRecord[],
          reason: "startup" | "interval",
          nowIso: string,
      ): number {
          // Purge les anciens edges inférés
          let changed = false;
          for (const [id] of this.health.listRanked().entries()) {
              const c = this.health.getConnection(String(id));
              if (c?.metadata && typeof c.metadata === "object" &&
                  c.metadata.inferredFromClusterSync === true) {
                  this.health.removeByNodeId(c.targetNodeId);
                  changed = true;
              }
          }

          const activeNodes = nodes.filter((n) => n.status !== "revoked");
          const knownNodes: ClusterSyncNodeRecord[] = [
              {
                  nodeId: this.identity.getNodeId(),
                  serverUrl: this.identity.resolveLocalServerUrl(),
                  status: "active",
                  healthy: true,
                  lastSeenAt: this.identity.getLocalNode().lastSeenAt,
              },
              ...activeNodes.filter((n) => n.nodeId !== this.identity.getNodeId()),
          ];

          const fanout = this.resolveFanout(knownNodes.length);
          let inferredCount = 0;

          for (const source of knownNodes) {
              if (source.nodeId === this.identity.getNodeId()) continue;

              const targets = this.rankTargets(
                  source,
                  knownNodes.filter((n) => n.nodeId !== source.nodeId),
              ).slice(0, fanout);

              for (const target of targets) {
                  const existing = this.health.findBySourceAndTarget(source.nodeId, target.nodeId);
                  if (existing) continue;

                  const metrics = this.meshLogic.computeWeightedMetrics({
                      latencyMs: source.healthy && target.healthy ? 40 : 120,
                      jitterMs: source.healthy && target.healthy ? 8 : 24,
                      packetLossRatio: source.healthy && target.healthy ? 0.005 : 0.03,
                      throughputMbps: source.healthy && target.healthy ? 800 : 220,
                      reliabilityScore: source.healthy && target.healthy ? 0.99 : 0.85,
                      weight: 0,
                      measuredAt: nowIso,
                  });

                  const conn = meshPeerConnectionSchema.parse({
                      connectionId: this.deterministicConnectionId(source.nodeId, target.nodeId),
                      sourceNodeId: source.nodeId,
                      targetNodeId: target.nodeId,
                      state: source.healthy && target.healthy ? "up" : "degraded",
                      metrics,
                      activePathRank: 1,
                      lastHeartbeatAt: nowIso,
                      metadata: {
                          inferredFromClusterSync: true,
                          syncReason: reason,
                          sourceServerUrl: source.serverUrl,
                          targetServerUrl: target.serverUrl,
                      },
                  });

                  this.health.upsertFromReconcile(conn);
                  inferredCount += 1;
                  changed = true;
              }
          }

          if (changed) this.health.recomputeRanks();
          return inferredCount;
      }

      // ─── Helpers ─────────────────────────────────────────────────────────────

      private upsertRemoteNodeFromRecord(node: ClusterSyncNodeRecord, nowIso: string): void {
          const existing = this.membership.getRemoteNode(node.nodeId);
          const lifecycleState = this.resolveLifecycle(node);

          const next: MeshNodeState = meshNodeStateSchema.parse({
              nodeId: node.nodeId,
              region: existing?.region ?? "cluster",
              roles: existing?.roles ?? ["relay"],
              lifecycleState,
              routingMode: existing?.routingMode ?? "balanced",
              consistencyMode: existing?.consistencyMode ?? this.identity.getLocalNode().consistencyMode,
              version: existing?.version ?? "cluster-sync",
              startedAt: existing?.startedAt ?? nowIso,
              lastSeenAt: this.normalizeTimestamp(node.lastSeenAt, nowIso),
              metadata: {
                  ...(existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
                  serverUrl: node.serverUrl,
                  source: "cluster_nodes_sync",
              },
          });

          this.membership.upsertRemoteNode(next);
      }

      private resolveLifecycle(node: ClusterSyncNodeRecord): MeshNodeState["lifecycleState"] {
          if (node.status === "draining") return "leaving";
          if (node.status === "suspect" || !node.healthy) return "suspect";
          return "healthy";
      }

      private normalizeTimestamp(ts: string | null, fallback: string): string {
          if (!ts) return fallback;
          const d = new Date(ts);
          return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
      }

      private resolveFanout(totalNodes: number): number {
          const peers = Math.max(0, totalNodes - 1);
          if (peers === 0) return 0;
          const dynamic = Math.max(1, Math.ceil(Math.log2(totalNodes + 1)));
          const configuredRaw = Number(process.env.MESH_PEER_MAX);
          const configured = Number.isFinite(configuredRaw) ? Math.max(1, Math.floor(configuredRaw)) : null;
          const bounded = configured !== null ? Math.min(dynamic, configured) : dynamic;
          return Math.min(peers, bounded);
      }

      private rankTargets(
          source: ClusterSyncNodeRecord,
          candidates: ClusterSyncNodeRecord[],
      ): ClusterSyncNodeRecord[] {
          return [...candidates].sort((a, b) => {
              if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
              const scoreA = this.affinityScore(source.nodeId, a.nodeId);
              const scoreB = this.affinityScore(source.nodeId, b.nodeId);
              if (scoreA !== scoreB) return scoreB - scoreA;
              return a.nodeId.localeCompare(b.nodeId);
          });
      }

      private affinityScore(src: string, tgt: string): number {
          return createHash("sha256")
              .update(`${src}->${tgt}`)
              .digest()
              .readUInt32BE(0);
      }

      private deterministicConnectionId(src: string, tgt: string): string {
          const hex = createHash("sha256")
              .update(`${src}->${tgt}`)
              .digest("hex")
              .slice(0, 32)
              .split("");
          hex[12] = "4";
          hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
          const c = hex.join("");
          return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20, 32)}`;
      }

      private toMeshEndpointUrl(serverUrl: string): string {
          try {
              const p = new URL(serverUrl);
              const proto = p.protocol === "https:" ? "wss:" : "ws:";
              const path = p.pathname.endsWith("/") ? `${p.pathname}mesh` : `${p.pathname}/mesh`;
              return `${proto}//${p.host}${path}`;
          } catch {
              return serverUrl;
          }
      }

      // ─── Baseline metrics helpers ─────────────────────────────────────────────

      private existingConn(sessionId: string): MeshPeerConnection | undefined {
          const session = this.sessions.getById(sessionId);
          if (!session?.peerNodeId) return undefined;
          return this.health.findBySourceAndTarget(this.identity.getNodeId(), session.peerNodeId);
      }

      private baselineLatency(sessionId: string, node: ClusterSyncNodeRecord): number {
          const conn = this.existingConn(sessionId);
          return Math.max(1, Math.min(conn?.metrics.latencyMs ?? 40, node.healthy ? 250 : 2_000));
      }

      private baselineJitter(sessionId: string, node: ClusterSyncNodeRecord): number {
          const conn = this.existingConn(sessionId);
          return Math.max(1, Math.min(conn?.metrics.jitterMs ?? 8, node.healthy ? 80 : 400));
      }

      private baselinePacketLoss(sessionId: string, node: ClusterSyncNodeRecord): number {
          const conn = this.existingConn(sessionId);
          return node.healthy
              ? Math.min(conn?.metrics.packetLossRatio ?? 0.005, 0.05)
              : Math.max(conn?.metrics.packetLossRatio ?? 0.2, 0.2);
      }

      private baselineThroughput(sessionId: string, node: ClusterSyncNodeRecord): number {
          const conn = this.existingConn(sessionId);
          return Math.max(1, conn?.metrics.throughputMbps ?? (node.healthy ? 700 : 30));
      }

      private baselineReliability(sessionId: string, node: ClusterSyncNodeRecord): number {
          const conn = this.existingConn(sessionId);
          return node.healthy
              ? Math.max(conn?.metrics.reliabilityScore ?? 0.99, 0.8)
              : Math.min(conn?.metrics.reliabilityScore ?? 0.5, 0.7);
      }

      private errMsg(e: unknown): string {
          return e instanceof Error ? e.message : "unknown_error";
      }
  }