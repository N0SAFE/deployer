import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { meshContract, type MeshContract } from "@repo/api-contracts";
import { signMeshToken } from "@repo/auth/mesh";
import { MeshValidationError } from "../../services/system-mesh-topology/domain/mesh-errors";
import { toMeshWebSocketUrl } from "../../shared/utils/mesh-server-url.utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeshSetupSession {
    readonly remoteNodeId: string;
    readonly remoteBaseUrl: string;
    readonly client: ContractRouterClient<MeshContract>;
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

export interface MeshBootstrapConfig {
    /** The nodeId generated locally and accepted by the mesh */
    nodeId: string;
    databaseUrl: string;
    enrolledAt: string;
    /**
     * Long-lived peer service token the local node should use on every
     * subsequent peer-to-peer mesh call. Persist in
     * `NodeConfigRepository` so the token survives restarts.
     * Null when the remote mesh has no shared secret configured.
     */
    peerServiceToken: string | null;
    peerServiceTokenExpiresAt: string | null;
    /**
     * The mesh shared secret that all nodes in the cluster share.
     * Used by `requireMesh()` / `requireInternalMesh()` to verify peer
     * credentials. Persisted in `NodeConfigRepository.meshSharedSecret`
     * so the node can validate requests across restarts.
     * Null when the remote mesh has no shared secret configured.
     */
    meshSharedSecret: string | null;
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

    /**
     * Full bootstrap flow for a new node joining a cluster:
     *  1. Validate connectivity to the remote mesh
     *  2. Generate a local nodeId (UUID)
     *  3. Consume the join grant → mesh validates and returns
     *     { databaseUrl, enrolledAt, peerServiceToken, peerServiceTokenExpiresAt }
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

        // Generate a fresh UUID for this node.
        // The mesh will register it under this ID — must be persisted after.
        const nodeId = randomUUID();

        // First call uses no peer service token (we don't have one yet).
        // We MUST present the mesh-internal shared secret as
        // `X-Mesh-Internal-Key` so the peer's `requireInternalMesh()`
        // middleware accepts the call. The peer's controller comment
        // says it accepts the "legacy `requireInternalMesh()` channel
        // here" — both the signed v1 path and the bare-secret path work,
        // we choose v1 for replay protection.
        const sharedSecret = this.resolveSharedSecret();
        const preEnrollmentHeaders = sharedSecret
            ? { "x-mesh-internal-key": signMeshToken(sharedSecret) }
            : undefined;
        const preEnrollmentClient = this.createRemoteClient(
            normalized.origin,
            preEnrollmentHeaders,
        );

        const result = await preEnrollmentClient.consumeJoinGrant({
            grantToken,
            nodeId,
            serverUrl,
        });

        const peerServiceToken = result.peerServiceToken;
        const peerServiceTokenExpiresAt = result.peerServiceTokenExpiresAt;
        const meshSharedSecret = result.meshSharedSecret;

        return {
            nodeId:      result.nodeId,   // echo back from mesh (may differ if remapped)
            databaseUrl: result.databaseUrl,
            enrolledAt:  result.enrolledAt,
            peerServiceToken,
            peerServiceTokenExpiresAt,
            meshSharedSecret,
        };
    }

    /**
     * Issue a one-time join grant on a remote mesh node using an
     * authenticated Better Auth session.
     *
     * This is the first half of the two-step bootstrap for a remote
     * strategy node:
     *   1. Issue a grant on the remote mesh (requires auth session)
     *   2. Consume the grant via {@link bootstrap} (uses mesh internal key)
     *
     * The returned `grantToken` is a short random string that the
     * remote mesh stores as a hashed lookup — it is **not** a session
     * token or any user-facing credential.
     *
     * @param meshUrl      - Base URL of any node in the target cluster
     * @param authSession  - Better Auth session token obtained by signing
     *   in to the remote mesh via its `/api/auth/sign-in/email` endpoint.
     *   Can be passed as a raw token value (e.g. `"session-abc"`) or as a
     *   full `name=value` cookie pair (e.g.
     *   `"better-auth.session_token=abc"`). Raw values are automatically
     *   wrapped in the standard Better Auth cookie name.
     * @returns The grant token to pass to {@link bootstrap}.
     */
    async issueRemoteJoinGrant(
        meshUrl: string,
        authSession: string,
    ): Promise<string> {
        const normalized = this.normalizeUrl(meshUrl)

        // Normalize the session token into a proper Cookie header.
        // Better Auth's `getSession()` reads the session token from the
        // `better-auth.session_token` cookie.  The remoteAuth handler
        // may return the token as a raw value (from `result.token`) or
        // as a full `name=value` pair (from `Set-Cookie`).  Ensure we
        // always present it in cookie-name:value format.
        const sessionCookie = authSession.includes("=")
            ? authSession
            : `better-auth.session_token=${authSession}`

        // Authenticated client — sends the Better Auth session cookie so
        // the remote mesh's `requireAuth()` middleware accepts the call.
        const authClient = this.createRemoteClient(normalized.origin, {
            Cookie: sessionCookie,
        })

        const result = await authClient.issueJoinGrant({
            organizationId: null,
            targetNodeId: null,
            ttlSeconds: 900,
            metadata: null,
        })

        return result.grantToken
    }

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
        const remoteLocalNode = await client.getLocalNode();

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

    /**
     * Retrieves all known peer endpoint URLs from the remote mesh.
     * Filters out the local node's own URL to avoid self-connection.
     *
     * @param meshUrl           - Base URL of any node in the target cluster
     * @param localNodeId       - The local node's ID (to exclude from results)
     * @param peerServiceToken  - Optional peer service token (forwarded
     *   from the bootstrap result). Without it, the peer's
     *   `getLocalNode` / `listPeerSessions` calls would 401.
     */
    async getMeshNodeUrls(
        meshUrl: string,
        localNodeId: string,
        peerServiceToken?: string | null,
    ): Promise<string[]> {
        const session = await this.connectToMesh(meshUrl, { peerServiceToken });
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
    ): ContractRouterClient<MeshContract> {
        const link = new OpenAPILink(meshContract, {
            url:   baseUrl,
            fetch: (input, init) => {
                if (!internalHeaders) return fetch(input, init);
                const headers = new Headers();
                if (init && "headers" in init && init.headers) {
                    const existing = init.headers;
                    if (existing instanceof Headers) {
                        for (const [name, value] of existing.entries()) {
                            headers.set(name, value);
                        }
                    } else if (Array.isArray(existing)) {
                        for (const [name, value] of existing) {
                            if (typeof name === "string" && typeof value === "string") {
                                headers.set(name, value);
                            }
                        }
                    } else {
                        for (const [name, value] of Object.entries(existing as Record<string, string>)) {
                            headers.set(name, value);
                        }
                    }
                }
                for (const [name, value] of Object.entries(internalHeaders)) {
                    headers.set(name, value);
                }
                return fetch(input, { ...init, headers });
            },
        });
        return createORPCClient<ContractRouterClient<MeshContract>>(link);
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
            await client.ping();
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            throw new MeshValidationError(`Cannot reach mesh at ${baseUrl}: ${message}`);
        }
    }
}