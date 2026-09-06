/**
 * ClusterNodeRepository — persists this node's Swarm cluster snapshot into
 * the per-node local SQLite (`cluster_node`, single row).
 *
 * SW-012: upserts the local node (role/membership/master view) after the
 * Swarm bootstrap converges. SW-011: the worker+manager join tokens are
 * persisted here too so onboarding tokens survive restarts WITHOUT living
 * in `.env` — the fleet-scoped token distribution to peers still happens
 * through the mesh secret-sharing path (P2/P7).
 */

import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ConflictError } from "@repo/errors";
import type { ClusterSnapshot } from "@repo/contracts-entities";
import {
    clusterNode,
    clusterMasterHistory,
    type ClusterNodeRow,
} from "@/config/drizzle/local/schema";
import { LocalDatabaseService } from "@/core/modules/database/local/local-database.service";

@Injectable()
export class ClusterNodeRepository {
    constructor(private readonly localDb: LocalDatabaseService) {}

    find(): ClusterNodeRow | null {
        try {
            const rows = this.localDb.db.select().from(clusterNode).limit(1).all();
            return rows[0] ?? null;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("no such table: cluster_node")) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Persist a `ClusterSnapshot` (engine-derived) into the local cluster_node
     * row. The engine-truth snapshot is the single input — no field is read
     * from `process.env`. Re-reads and returns the stored row.
     */
    upsertFromSnapshot(snapshot: ClusterSnapshot): ClusterNodeRow {
        const now = new Date().toISOString();
        const node = snapshot.localNode;

        this.localDb.db
            .insert(clusterNode)
            .values({
                id: 1,
                clusterId: snapshot.clusterId,
                localNodeState: snapshot.localNodeState,
                swarmRole: node.swarmRole,
                platformRole: node.platformRole,
                isMaster: node.isMaster,
                isIngress: node.isIngress,
                availability: node.availability,
                nodeCount: snapshot.nodeCount,
                managerCount: snapshot.managerCount,
                masterNodeId: snapshot.master?.nodeId ?? null,
                masterTerm: snapshot.master?.term ?? 0,
                joinTokenWorker: snapshot.joinTokens?.worker ?? null,
                joinTokenManager: snapshot.joinTokens?.manager ?? null,
                lastHeartbeatAt: node.lastHeartbeatAt ?? now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: clusterNode.id,
                set: {
                    clusterId: snapshot.clusterId,
                    localNodeState: snapshot.localNodeState,
                    swarmRole: node.swarmRole,
                    platformRole: node.platformRole,
                    isMaster: node.isMaster,
                    isIngress: node.isIngress,
                    availability: node.availability,
                    nodeCount: snapshot.nodeCount,
                    managerCount: snapshot.managerCount,
                    masterNodeId: snapshot.master?.nodeId ?? null,
                    masterTerm: snapshot.master?.term ?? 0,
                    joinTokenWorker: snapshot.joinTokens?.worker ?? null,
                    joinTokenManager: snapshot.joinTokens?.manager ?? null,
                    lastHeartbeatAt: node.lastHeartbeatAt ?? now,
                    updatedAt: now,
                },
            })
            .run();

        const row = this.find();
        if (!row) {
            throw new ConflictError("ClusterNode upsert succeeded but row was not found");
        }
        return row;
    }

    /**
     * CAS claim of the controlling-master row (P4 election, doc-02 §6).
     * Only succeeds when the observed term matches the persisted term —
     * the single-winner guarantee for concurrent elections. On success the
     * term is incremented and the node recorded as master.
     */
    claimMaster(nodeId: string, expectedTerm: number, _reason: string): boolean {
        const row = this.find();
        if (!row || row.masterTerm !== expectedTerm) {
            return false;
        }
        const now = new Date().toISOString();
        this.localDb.db
            .update(clusterNode)
            .set({
                masterNodeId: nodeId,
                masterTerm: expectedTerm + 1,
                isMaster: true,
                lastHeartbeatAt: now,
                updatedAt: now,
            })
            .where(eq(clusterNode.id, 1))
            .run();
        return true;
    }

    /** Refresh the master heartbeat (P5 watchdog — an active master is healthy). */
    touchMasterHeartbeat(): void {
        this.localDb.db
            .update(clusterNode)
            .set({ lastHeartbeatAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
            .where(eq(clusterNode.id, 1))
            .run();
    }

    /** Append one master-election audit row (SW-046). */
    recordMasterHistory(nodeId: string, term: number, reason: string, durationMs: number | null = null): void {
        this.localDb.db
            .insert(clusterMasterHistory)
            .values({
                nodeId,
                term,
                electedAt: new Date().toISOString(),
                reason,
                durationMs,
            })
            .run();
    }
}