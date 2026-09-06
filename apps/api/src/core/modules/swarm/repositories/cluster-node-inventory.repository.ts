/**
 * ClusterNodeInventoryRepository — fleet node inventory persistence
 * (SW-030). One row per Swarm node in the local SQLite `cluster_nodes`
 * table, upserted from `docker node ls` output (SDK). Cross-node reads for
 * the UI/ops use this stable snapshot; the live engine is only polled by
 * `NodeInventoryService`.
 */

import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { DockerodeNodeSummary } from "@repo/contracts-entities";
import { clusterNodes, type ClusterNodesRow } from "@/config/drizzle/local/schema";
import { LocalDatabaseService } from "@/core/modules/database/local/local-database.service";

export interface EngineNodeRow {
    nodeId: string;
    hostname: string;
    swarmRole: "manager" | "worker";
    platformRole: "both" | "control" | "worker";
    isLeader: boolean;
    isIngress: boolean;
    availability: "active" | "pause" | "drain";
    nanoCpus: number | null;
    memoryBytes: number | null;
    labels: Record<string, string>;
}

@Injectable()
export class ClusterNodeInventoryRepository {
    constructor(private readonly localDb: LocalDatabaseService) {}

    /** List the persisted inventory, newest-updated first. */
    list(): ClusterNodesRow[] {
        try {
            return this.localDb.db.select().from(clusterNodes).all();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("no such table: cluster_nodes")) {
                return [];
            }
            throw error;
        }
    }

    /** Find one node by engine id. */
    findByNodeId(nodeId: string): ClusterNodesRow | null {
        const rows = this.list();
        return rows.find((row) => row.nodeId === nodeId) ?? null;
    }

    /**
     * Upsert one node from engine truth. Returns the stored row.
     */
    upsertFromEngine(node: EngineNodeRow): ClusterNodesRow {
        const now = new Date().toISOString();
        this.localDb.db
            .insert(clusterNodes)
            .values({
                nodeId: node.nodeId,
                hostname: node.hostname,
                swarmRole: node.swarmRole,
                platformRole: node.platformRole,
                isLeader: node.isLeader,
                isIngress: node.isIngress,
                availability: node.availability,
                nanoCpus: node.nanoCpus,
                memoryBytes: node.memoryBytes,
                labels: node.labels,
                state: "active",
                lastSeenAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: clusterNodes.nodeId,
                set: {
                    hostname: node.hostname,
                    swarmRole: node.swarmRole,
                    platformRole: node.platformRole,
                    isLeader: node.isLeader,
                    isIngress: node.isIngress,
                    availability: node.availability,
                    nanoCpus: node.nanoCpus,
                    memoryBytes: node.memoryBytes,
                    labels: node.labels,
                    state: "active",
                    lastSeenAt: now,
                    updatedAt: now,
                },
            })
            .run();
        return this.findByNodeId(node.nodeId) as ClusterNodesRow;
    }

    /** Mark nodes not seen in the latest sweep as `down`. */
    markMissingNodeDown(nodeIdsSeen: string[]): number {
        const now = new Date().toISOString();
        const seen = new Set(nodeIdsSeen);
        let changed = 0;
        for (const row of this.list()) {
            if (seen.has(row.nodeId)) {
                continue;
            }
            this.localDb.db
                .update(clusterNodes)
                .set({ state: "down", updatedAt: now })
                .where(eq(clusterNodes.nodeId, row.nodeId))
                .run();
            changed += 1;
        }
        return changed;
    }

    /** Bulk upsert from engine node summaries (fallback / proactive sweep). */
    upsertAllFromEngine(nodes: DockerodeNodeSummary[]): number {
        for (const node of nodes) {
            this.upsertFromEngine(toEngineNodeRow(node));
        }
        return nodes.length;
    }
}

/** Pure mapper: dockerode node summary → repository row input (testable). */
export function toEngineNodeRow(node: DockerodeNodeSummary): EngineNodeRow {
    const labels = node.Spec?.Labels ?? {};
    return {
        nodeId: node.ID,
        hostname: node.Description?.Hostname ?? "",
        swarmRole: node.Spec?.Role === "manager" ? "manager" : "worker",
        platformRole: "both",
        isLeader: node.ManagerStatus?.Leader === true,
        isIngress: labels["deployer.ingress"] === "true",
        availability:
            node.Spec?.Availability === "pause" || node.Spec?.Availability === "drain"
                ? node.Spec.Availability
                : "active",
        nanoCpus: node.Description?.Resources?.NanoCPUs ?? null,
        memoryBytes: node.Description?.Resources?.MemoryBytes ?? null,
        labels,
    };
}