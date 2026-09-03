import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { clusterJoinGrants, clusterNodeMetrics, clusterNodes, clusterSigningKeys, resourceOwnershipIndex } from "@/config/drizzle/global/schema";
import type { MeshResourceIndexUpsertInput, MeshResourceLocation } from "@repo/contracts-entities";
import { GlobalDatabaseService } from "../../database/global/global-database.service";
import { NodeConfigRepository } from "../../setup/repositories/node-config.repository";

import { AppError } from "@repo/errors";
@Injectable()
export class SystemMeshClusterRepository {
    constructor(
        private readonly databaseService: GlobalDatabaseService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    /**
     * Read the database URL from the local SQLite node_config table.
     * This is populated by the Phase 0 setup sub-app and is the ONLY
     * source of truth for the database URL at runtime.
     */
    private getDatabaseUrlFromConfig(): string | null {
        const config = this.nodeConfigRepository.find();
        return config?.databaseUrl?.trim() ?? null;
    }

    async loadActiveClusterNodes(): Promise<{
        nodeId: string;
        serverUrl: string;
        status: "active" | "suspect" | "draining" | "revoked";
        healthy: boolean;
        lastSeenAt: string | null;
    }[]> {
        const rows = await this.databaseService.db
            .select({
                nodeId: clusterNodes.nodeId,
                serverUrl: clusterNodes.serverUrl,
                status: clusterNodes.status,
                healthy: clusterNodes.healthy,
                lastSeenAt: clusterNodes.lastSeenAt,
            })
            .from(clusterNodes);

        return rows.map((row) => ({
            nodeId: row.nodeId,
            serverUrl: row.serverUrl,
            status: row.status,
            healthy: row.healthy,
            lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
        }));
    }

    async loadSigningKeys(): Promise<{ keyId: string; algorithm: "HS256"; secretMaterial: string; status: "active" | "previous" }[]> {
        const rows = await this.databaseService.db
            .select({
                keyId: clusterSigningKeys.kid,
                algorithm: clusterSigningKeys.algorithm,
                secretMaterial: clusterSigningKeys.secretMaterial,
                status: clusterSigningKeys.status,
            })
            .from(clusterSigningKeys)
            .where(
                and(
                    inArray(clusterSigningKeys.status, ["active", "previous"]),
                    isNull(clusterSigningKeys.revokedAt),
                ),
            );

        return rows
            .filter((row): row is { keyId: string; algorithm: "HS256"; secretMaterial: string; status: "active" | "previous" } =>
                row.algorithm === "HS256" && (row.status === "active" || row.status === "previous"),
            )
            .map((row) => ({
                keyId: row.keyId,
                algorithm: "HS256" as const,
                secretMaterial: row.secretMaterial,
                status: row.status,
            }));
    }

    async loadAllResourceLocations(): Promise<MeshResourceLocation[]> {
        const rows = await this.databaseService.db
            .select()
            .from(resourceOwnershipIndex);

        const locations: MeshResourceLocation[] = [];
        for (const row of rows) {
            if (!this.isMeshResourceKind(row.resourceKind)) {
                continue;
            }

            const metadata = (row.metadata ?? {});
            const ownerServerUrl =
                row.ownerServerUrl ??
                (typeof metadata.ownerServerUrl === "string" ? metadata.ownerServerUrl : null);
            const endpointPath = typeof metadata.endpointPath === "string" ? metadata.endpointPath : null;
            const protocol = this.toMeshProtocol(metadata.protocol);

            if (!ownerServerUrl || !endpointPath || !protocol) {
                continue;
            }

            locations.push({
                kind: row.resourceKind,
                key: row.resourceKey,
                ownerNodeId: row.ownerNodeId,
                ownerServerUrl,
                endpointPath,
                endpointMethod: this.toHttpMethod(metadata.endpointMethod),
                protocol,
                persistentConnectionRequired:
                    typeof metadata.persistentConnectionRequired === "boolean"
                        ? metadata.persistentConnectionRequired
                        : false,
                abortEndpointPath:
                    typeof metadata.abortEndpointPath === "string" ? metadata.abortEndpointPath : undefined,
                priority: row.priority,
                version: row.version,
                updatedAt: row.updatedAt.toISOString(),
                metadata,
            });
        }

        return locations;
    }

    async persistResourceIndexUpsert(input: MeshResourceIndexUpsertInput): Promise<void> {
        if (input.replaceExistingForSource) {
            await this.databaseService.db
                .delete(resourceOwnershipIndex)
                .where(
                    eq(resourceOwnershipIndex.ownerNodeId, input.sourceNodeId),
                );
        }

        for (const resource of input.resources) {
            await this.databaseService.db
                .delete(resourceOwnershipIndex)
                .where(
                    and(
                        eq(resourceOwnershipIndex.resourceKind, resource.kind),
                        eq(resourceOwnershipIndex.resourceKey, resource.key),
                        eq(resourceOwnershipIndex.ownerNodeId, resource.ownerNodeId),
                    ),
                );

            await this.databaseService.db.insert(resourceOwnershipIndex).values({
                resourceKind: resource.kind,
                resourceKey: resource.key,
                ownerNodeId: resource.ownerNodeId,
                ownerServerUrl: resource.ownerServerUrl,
                priority: resource.priority,
                status: "active",
                version: resource.version,
                updatedAt: new Date(resource.updatedAt),
                observedAt: new Date(resource.updatedAt),
                metadata: {
                    ...(resource.metadata ?? {}),
                    ownerServerUrl: resource.ownerServerUrl,
                    endpointPath: resource.endpointPath,
                    protocol: resource.protocol,
                    endpointMethod: resource.endpointMethod,
                    persistentConnectionRequired: resource.persistentConnectionRequired,
                    abortEndpointPath: resource.abortEndpointPath,
                },
            });
        }
    }

    async persistNodeHeartbeat(input: {
        nodeId: string;
        serverUrl?: string | null;
        metrics: {
            latencyMs: number;
            jitterMs: number;
            packetLossRatio: number;
            throughputMbps: number;
            reliabilityScore: number;
            weight: number;
            measuredAt: string;
        };
    }): Promise<void> {
        await this.databaseService.db
            .insert(clusterNodes)
            .values({
                nodeId: input.nodeId,
                serverUrl: input.serverUrl ?? `https://${input.nodeId}.mesh.internal`,
                status: "active",
                healthy: true,
                lastSeenAt: new Date(input.metrics.measuredAt),
            })
            .onConflictDoUpdate({
                target: clusterNodes.nodeId,
                set: {
                    serverUrl: input.serverUrl ?? `https://${input.nodeId}.mesh.internal`,
                    status: "active",
                    healthy: true,
                    lastSeenAt: new Date(input.metrics.measuredAt),
                    updatedAt: new Date(),
                },
            });

        await this.databaseService.db.insert(clusterNodeMetrics).values({
            nodeId: input.nodeId,
            metrics: {
                cpuUsage: this.clamp01(input.metrics.packetLossRatio),
                memoryUsage: this.clamp01(1 - input.metrics.reliabilityScore),
                activeStreams: Math.round(input.metrics.throughputMbps),
                queueDepth: Math.round(input.metrics.latencyMs + input.metrics.jitterMs),
                errorRate: this.clamp01(input.metrics.packetLossRatio),
            },
            reportedAt: new Date(input.metrics.measuredAt),
        });
    }

    async issueJoinGrant(input: {
        targetNodeId?: string | null;
        issuedByUserId: string;
        ttlSeconds: number;
        metadata?: Record<string, unknown> | null;
    }): Promise<{ grantId: string; grantToken: string; expiresAt: string }> {
        const grantToken = randomUUID();
        const grantTokenHash = this.hashJoinGrantToken(grantToken);
        const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);

        const [created] = await this.databaseService.db
            .insert(clusterJoinGrants)
            .values({
                targetNodeId: input.targetNodeId ?? null,
                issuedByUserId: input.issuedByUserId,
                grantTokenHash,
                status: "issued",
                expiresAt,
                metadata: input.metadata ?? null,
            })
            .returning({
                id: clusterJoinGrants.id,
                expiresAt: clusterJoinGrants.expiresAt,
            });

        if (!created) {
            throw new AppError("Failed to create join grant record", "INTERNAL_ERROR");
        }

        return {
            grantId: created.id,
            grantToken,
            expiresAt: created.expiresAt.toISOString(),
        };
    }

    async consumeJoinGrant(input: {
        grantToken: string;
        nodeId: string;
        serverUrl: string;
        displayName?: string;
        capabilities?: Record<string, unknown> | null;
        metadata?: Record<string, unknown> | null;
    }): Promise<{
        grantId: string;
        nodeId: string;
        enrolledAt: string;
        databaseUrl: string;
    } | null> {
        const now = new Date();
        const grantTokenHash = this.hashJoinGrantToken(input.grantToken);

        const [grant] = await this.databaseService.db
            .select()
            .from(clusterJoinGrants)
            .where(and(eq(clusterJoinGrants.grantTokenHash, grantTokenHash), eq(clusterJoinGrants.status, "issued"), gt(clusterJoinGrants.expiresAt, now)))
            .limit(1);

        if (!grant) {
            return null;
        }

        if (grant.targetNodeId && grant.targetNodeId !== input.nodeId) {
            return null;
        }

        const consumedAt = new Date();

        const [updatedGrant] = await this.databaseService.db
            .update(clusterJoinGrants)
            .set({
                status: "used",
                usedAt: consumedAt,
                updatedAt: consumedAt,
            })
            .where(and(eq(clusterJoinGrants.id, grant.id), eq(clusterJoinGrants.status, "issued")))
            .returning({
                id: clusterJoinGrants.id,
            });

        if (!updatedGrant) {
            return null;
        }

        await this.databaseService.db
            .insert(clusterNodes)
            .values({
                nodeId: input.nodeId,
                serverUrl: input.serverUrl,
                displayName: input.displayName ?? null,
                capabilities: input.capabilities ?? null,
                status: "active",
                healthy: true,
                metadata: {
                    ...(grant.metadata ?? {}),
                    ...(input.metadata ?? {}),
                    enrolledVia: "bootstrap_join_grant",
                    joinGrantId: updatedGrant.id,
                },
                enrolledAt: consumedAt,
                lastSeenAt: consumedAt,
            })
            .onConflictDoUpdate({
                target: clusterNodes.nodeId,
                set: {
                    serverUrl: input.serverUrl,
                    displayName: input.displayName ?? null,
                    capabilities: input.capabilities ?? null,
                    status: "active",
                    healthy: true,
                    metadata: {
                        ...(grant.metadata ?? {}),
                        ...(input.metadata ?? {}),
                        enrolledVia: "bootstrap_join_grant",
                        joinGrantId: updatedGrant.id,
                    },
                    lastSeenAt: consumedAt,
                    updatedAt: consumedAt,
                },
            });

        // The `databaseUrl` is the shared global Postgres URL the
        // joining node should connect to. In a mesh setup every node
        // points at the same cluster DB, so we return the same URL
        // from the receiving side. The URL is read from the local SQLite
        // node_config table (populated by Phase 0 setup sub-app).
        // The contract requires `z.url()`, so we throw loudly if the
        // URL is missing.
        const databaseUrl = this.getDatabaseUrlFromConfig();
        if (!databaseUrl) {
            throw new AppError(
                "No database URL in node_config — the receiving mesh node " +
                    "cannot return it to the joining peer. Run the setup wizard first.",
"INTERNAL_ERROR");
        }

        return {
            grantId: updatedGrant.id,
            nodeId: input.nodeId,
            enrolledAt: consumedAt.toISOString(),
            databaseUrl,
        };
    }

    async revokeJoinGrant(input: {
        grantId: string;
        revokedByUserId: string;
        reason?: string | null;
    }): Promise<{ grantId: string; revokedAt: string } | null> {
        const [grant] = await this.databaseService.db
            .select()
            .from(clusterJoinGrants)
            .where(eq(clusterJoinGrants.id, input.grantId))
            .limit(1);

        if (grant?.status !== "issued") {
            return null;
        }

        const revokedAt = new Date();
        const [revoked] = await this.databaseService.db
            .update(clusterJoinGrants)
            .set({
                status: "revoked",
                revokedAt,
                updatedAt: revokedAt,
                metadata: {
                    ...(grant.metadata ?? {}),
                    revokedByUserId: input.revokedByUserId,
                    revokeReason: input.reason ?? null,
                },
            })
            .where(and(eq(clusterJoinGrants.id, grant.id), eq(clusterJoinGrants.status, "issued")))
            .returning({
                id: clusterJoinGrants.id,
            });

        if (!revoked) {
            return null;
        }

        return {
            grantId: revoked.id,
            revokedAt: revokedAt.toISOString(),
        };
    }

    async rotateSigningKey(input: {
        keyId: string;
        secretMaterial: string;
        expiresAt?: string | null;
    }): Promise<{ activeKeyId: string; rotatedKeyId: string; secretMaterial: string }> {
        const now = new Date();

        await this.databaseService.db
            .update(clusterSigningKeys)
            .set({
                status: "previous",
                rotatedAt: now,
                updatedAt: now,
            })
            .where(eq(clusterSigningKeys.status, "active"));

        await this.databaseService.db.insert(clusterSigningKeys).values({
            kid: input.keyId,
            algorithm: "HS256",
            status: "active",
            secretMaterial: input.secretMaterial,
            activatedAt: now,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            updatedAt: now,
        });

        return {
            activeKeyId: input.keyId,
            rotatedKeyId: input.keyId,
            secretMaterial: input.secretMaterial,
        };
    }

    async registerOrUpdateNode(input: {
        nodeId: string;
        serverUrl: string;
        displayName?: string | null;
        capabilities?: Record<string, unknown> | null;
        metadata?: Record<string, unknown> | null;
    }): Promise<{ nodeId: string; status: "registered" | "updated"; enrolledAt: string }> {
        const enrolledAt = new Date();

        const [existing] = await this.databaseService.db
            .select({ nodeId: clusterNodes.nodeId })
            .from(clusterNodes)
            .where(eq(clusterNodes.nodeId, input.nodeId))
            .limit(1);

        await this.databaseService.db
            .insert(clusterNodes)
            .values({
                nodeId: input.nodeId,
                serverUrl: input.serverUrl,
                displayName: input.displayName ?? null,
                capabilities: input.capabilities ?? null,
                status: "active",
                healthy: true,
                metadata: input.metadata ?? null,
                enrolledAt,
                lastSeenAt: enrolledAt,
            })
            .onConflictDoUpdate({
                target: clusterNodes.nodeId,
                set: {
                    serverUrl: input.serverUrl,
                    displayName: input.displayName ?? null,
                    capabilities: input.capabilities ?? null,
                    status: "active",
                    healthy: true,
                    metadata: input.metadata ?? null,
                    lastSeenAt: enrolledAt,
                    updatedAt: enrolledAt,
                },
            });

        return {
            nodeId: input.nodeId,
            status: existing ? "updated" : "registered",
            enrolledAt: enrolledAt.toISOString(),
        };
    }

    private hashJoinGrantToken(token: string): string {
        const pepper = "mesh-join-grant";
        return createHash("sha256")
            .update(`${pepper}:${token}`)
            .digest("hex");
    }

    private isMeshResourceKind(value: string): value is MeshResourceLocation["kind"] {
        return value === "deployment" || value === "stream" || value === "log" || value === "queue" || value === "topic";
    }

    private toMeshProtocol(value: unknown): MeshResourceLocation["protocol"] | null {
        return value === "http" || value === "https" || value === "ws" || value === "wss" || value === "sse"
            ? value
            : null;
    }

    private toHttpMethod(value: unknown): MeshResourceLocation["endpointMethod"] {
        return value === "GET" || value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE"
            ? value
            : "GET";
    }

    private clamp01(value: number): number {
        if (Number.isNaN(value)) {
            return 0;
        }
        if (value < 0) {
            return 0;
        }
        if (value > 1) {
            return 1;
        }
        return value;
    }
}