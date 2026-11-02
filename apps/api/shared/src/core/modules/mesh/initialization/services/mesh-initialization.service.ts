import { Injectable } from "@nestjs/common";
import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";

import {
    
    
    
    
    
} from "@deployer/contracts-entities";
import { meshContract, type MeshContract } from "@deployer/fleet-contracts";

import { MeshValidationError } from "../../services/system-mesh-topology/domain/mesh-errors";

import type { ContractRouterClient } from "@orpc/contract";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The mesh-to-mesh client surface. The initialization flow dials other nodes
 * using BOTH the public surface (ping, getLocalNode, listPeerSessions,
 * issueJoinGrant — served to authenticated callers) and the internal
 * transport surface (consumeJoinGrant — the enrollment handshake). Merging
 * the two routers gives one typed client for the whole mesh-to-mesh API.
 */
export type MeshClientContract = MeshContract;
const meshClientRouter = meshContract;

export type MeshSetupSession = {
    readonly remoteNodeId: string;
    readonly remoteBaseUrl: string;
    readonly client: ContractRouterClient<MeshClientContract>;
    /**
     * Long-lived peer service token issued by the remote mesh during
     * `consumeJoinGrant`. Carried in `X-Mesh-Internal-Key` on every
     * subsequent peer-to-peer call.
     * Null when the remote mesh has no shared secret configured.
     */
    readonly peerServiceToken: string | null;
    /**
     * ISO timestamp at which `peerServiceToken` stops being accepted.
     * Used to surface expiring tokens in the UI / healthchecks.
     * Null when no token was issued.
     */
    readonly peerServiceTokenExpiresAt: string | null;
    close(): Promise<void>;
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
 *
 * Peer-to-peer auth flow after enrollment:
 *   - `consumeJoinGrant` returns a `peerServiceToken` (HMAC-signed with a
 *     node-specific secret) bound to the local nodeId.
 *   - The local node sends it as `X-Mesh-Internal-Key` on every
 *     subsequent peer call (`getLocalNode`, `listPeerSessions`, …).
 *   - The peer's `requireMeshPeer()` middleware verifies the token and
 *     synthesizes an auth context attributing the call to the local
 *     nodeId, so the peer never sees a Better Auth user session.
 */
@Injectable()
export class MeshInitializationService {

    // ─── Bootstrap ────────────────────────────────────────────────────────────

    // ─── Session ──────────────────────────────────────────────────────────────

    /**
     * Opens a typed oRPC session to a remote mesh node.
     * Used for post-bootstrap operations (registerNode, listPeerSessions…).
     *
     * @param meshUrl           - Base URL of any node in the target cluster
     * @param peerServiceToken  - Optional peer service token. If omitted,
     *   only the public `ping` endpoint and the mesh-internal shared
     *   secret channel are usable. If provided, all peer-to-peer mesh
     *   endpoints (`getLocalNode`, `listPeerSessions`, …) are reachable.
     */
    async connectToMesh(
        meshUrl: string,
        options: { peerServiceToken?: string | null } = {},
    ): Promise<MeshSetupSession> {
        const normalized = this.normalizeUrl(meshUrl);
        await this.validateRemoteMesh(normalized.origin);

        const peerServiceToken = options.peerServiceToken ?? "";
        const client = this.createRemoteClient(
            normalized.origin,
            peerServiceToken.length > 0
                ? { "x-mesh-internal-key": peerServiceToken }
                : undefined,
        );
        const remoteLocalNode = await client.getLocalNode({});

        return {
            remoteNodeId:  remoteLocalNode.nodeId,
            remoteBaseUrl: normalized.origin,
            client,
            peerServiceToken,
            // For convenience, report "never expires" when we don't
            // have a token. Callers that need accurate expiry can
            // re-enroll and inspect `MeshBootstrapConfig`.
            peerServiceTokenExpiresAt: peerServiceToken.length > 0
                ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                : new Date(0).toISOString(),
            close: () => Promise.resolve(),
        };
    }

    // ─── Node URLs ────────────────────────────────────────────────────────────

    // ─── Private helpers ──────────────────────────────────────────────────────

    /**
     * Create an oRPC client for a remote mesh node.
     *
     * If `internalHeaders` is provided, every request sent by this
     * client carries them. The pre-enrollment path passes
     * `{ "x-mesh-internal-key": <signed v1 token> }` so the peer's
     * `requireInternalMesh()` middleware accepts the call. The
     * post-enrollment path passes the long-lived peer service token.
     */
    private createRemoteClient(
        baseUrl: string,
        internalHeaders?: Record<string, string>,
    ): ContractRouterClient<MeshClientContract> {
        const link = new OpenAPILink(meshClientRouter, {
            // v2 split the old single `url` in two: `url` is the base PATH (it
            // must match the OpenAPI handler's mount path) and `origin` is the
            // scheme+host. `baseUrl` here is an origin (`http://host:port`).
            origin: baseUrl,
            fetch: (input, init) => {
                if (!internalHeaders) return fetch(input, init);
                // `Headers` already accepts every `HeadersInit` shape (record, tuple list, Headers), including a
                // record whose value is several strings for one name. Re-implementing that normalization by hand
                // produced a `string | readonly string[]` union that differs per lib.
                const headers = new Headers("headers" in init ? init.headers : undefined);
                for (const [name, value] of Object.entries(internalHeaders)) {
                    headers.set(name, value);
                }
                return fetch(input, { ...init, headers });
            },
        });
        return createORPCClient<ContractRouterClient<MeshClientContract>>(link);
    }

    /**
     * Read the mesh-internal shared secret from env.
     * Returns `null` when not configured; callers must decide whether
     * that is acceptable for the endpoint they are calling.
     */
    private resolveSharedSecret(): string | null {
        const raw = process.env.MESH_STREAM_SHARED_SECRET;
        if (typeof raw !== "string") return null;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    private normalizeUrl(value: string): URL {
        try {
            return new URL(value);
        } catch {
            throw new MeshValidationError("The provided mesh URL is invalid.");
        }
    }

    private async validateRemoteMesh(baseUrl: string): Promise<void> {
        // Use the public `ping` endpoint for connectivity validation. At
        // bootstrap time we have neither a user session nor an internal
        // mesh key, so we cannot hit the authenticated `getLocalNode` —
        // it would 401. `ping` is purpose-built for this: it returns
        // just `{ ok, version, advertisedHost }` and requires no auth.
        //
        // Anything beyond reachability (peer identity, peer sessions, …)
        // is deferred to the post-enrollment steps where the local node
        // has a valid `MeshSetupSession` client.
        const client = this.createRemoteClient(baseUrl);
        try {
            await client.ping({});
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new MeshValidationError(`Cannot reach mesh at ${baseUrl}: ${message}`);
        }
    }
}