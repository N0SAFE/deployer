import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { meshContract, type MeshContract } from "@repo/api-contracts";
import { MeshValidationError } from "../../services/system-mesh-topology/domain/mesh-errors";
import { toMeshWebSocketUrl } from "../../shared/utils/mesh-server-url.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeshSetupSession {
    readonly remoteNodeId: string;
    readonly remoteBaseUrl: string;
    readonly client: ContractRouterClient<MeshContract>;
    close(): Promise<void>;
}

export interface MeshBootstrapConfig {
    /** The nodeId generated locally and accepted by the mesh */
    nodeId: string;
    databaseUrl: string;
    enrolledAt: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Handles the initial bootstrap of a new node joining an existing mesh cluster.
 *
 * Intentionally has NO dependency on MeshIdentityService — at bootstrap time
 * the local node has no persisted identity yet.
 *
 * Identity flow:
 *   - The nodeId is generated HERE (randomUUID) and sent to the mesh
 *   - The mesh validates the grant and accepts/rejects the nodeId
 *   - On success, the caller persists the nodeId to NodeConfigRepository
 *   - From that point on, NodeConfigRepository is the source of truth
 */
@Injectable()
export class MeshInitializationService {

    // ─── Bootstrap ────────────────────────────────────────────────────────────

    /**
     * Full bootstrap flow for a new node joining a cluster:
     *  1. Validate connectivity to the remote mesh
     *  2. Generate a local nodeId (UUID)
     *  3. Consume the join grant → mesh validates and returns { databaseUrl, enrolledAt }
     *
     * @param meshUrl    - Base URL of any node in the target cluster
     * @param grantToken - One-time join grant token issued by the mesh admin
     * @param serverUrl  - Public URL of this node (so the mesh can reach us back)
     */
    async bootstrap(
        meshUrl: string,
        grantToken: string,
        serverUrl: string,
    ): Promise<MeshBootstrapConfig> {
        const normalized = this.normalizeUrl(meshUrl);
        await this.validateRemoteMesh(normalized.origin);

        const client = this.createRemoteClient(normalized.origin);

        // Generate a fresh UUID for this node.
        // The mesh will register it under this ID — must be persisted after.
        const nodeId = randomUUID();

        const result = await client.consumeJoinGrant({
            grantToken,
            nodeId,
            serverUrl,
        });

        return {
            nodeId:      result.body.nodeId,   // echo back from mesh (may differ if remapped)
            databaseUrl: result.body.databaseUrl,
            enrolledAt:  result.body.enrolledAt,
        };
    }

    // ─── Session ──────────────────────────────────────────────────────────────

    /**
     * Opens a typed oRPC session to a remote mesh node.
     * Used for post-bootstrap operations (registerNode, listPeerSessions…).
     */
    async connectToMesh(meshUrl: string): Promise<MeshSetupSession> {
        const normalized = this.normalizeUrl(meshUrl);
        await this.validateRemoteMesh(normalized.origin);

        const client = this.createRemoteClient(normalized.origin);
        const remoteLocalNode = await client.getLocalNode();

        return {
            remoteNodeId:  remoteLocalNode.nodeId,
            remoteBaseUrl: normalized.origin,
            client,
            close: () => Promise.resolve(),
        };
    }

    // ─── Node URLs ────────────────────────────────────────────────────────────

    /**
     * Retrieves all known peer endpoint URLs from the remote mesh.
     * Filters out the local node's own URL to avoid self-connection.
     *
     * @param meshUrl     - Base URL of any node in the target cluster
     * @param localNodeId - The local node's ID (to exclude from results)
     */
    async getMeshNodeUrls(meshUrl: string, localNodeId: string): Promise<string[]> {
        const session = await this.connectToMesh(meshUrl);
        try {
            const [localNode, peerSessions] = await Promise.all([
                session.client.getLocalNode(),
                session.client.listPeerSessions(),
            ]);

            const nodeUrls = new Set<string>();

            for (const entry of peerSessions.items) {
                if (typeof entry.endpointUrl === "string" && entry.endpointUrl.length > 0) {
                    nodeUrls.add(entry.endpointUrl);
                }
            }

            if (typeof localNode.nodeId === "string" && localNode.nodeId.length > 0) {
                const localPeerSession = peerSessions.items.find(
                    (entry) => entry.peerNodeId === localNode.nodeId,
                );
                if (typeof localPeerSession?.endpointUrl === "string") {
                    nodeUrls.add(localPeerSession.endpointUrl);
                }
            }

            return [...nodeUrls].filter(
                (url) => !toMeshWebSocketUrl(url).includes(localNodeId),
            );
        } finally {
            await session.close();
        }
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private createRemoteClient(baseUrl: string): ContractRouterClient<MeshContract> {
        const link = new OpenAPILink(meshContract, {
            url:   baseUrl,
            fetch: (input, init) => fetch(input, init),
        });
        return createORPCClient<ContractRouterClient<MeshContract>>(link);
    }

    private normalizeUrl(value: string): URL {
        try {
            return new URL(value);
        } catch {
            throw new MeshValidationError("The provided mesh URL is invalid.");
        }
    }

    private async validateRemoteMesh(baseUrl: string): Promise<void> {
        const client = this.createRemoteClient(baseUrl);
        try {
            await client.getLocalNode();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new MeshValidationError(`Cannot reach mesh at ${baseUrl}: ${message}`);
        }
    }
}