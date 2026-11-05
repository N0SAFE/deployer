import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { Context, Effect } from "effect";

import { meshContract, type MeshContract } from "@deployer/fleet-contracts";

import { MeshPeerUnreachable, MeshPeerUrlInvalid } from "../../mesh.errors";

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

/** Opens a typed oRPC client on a remote mesh origin; a spec hands out a fake. */
export type MeshClientFactory = (origin: string, internalHeaders?: Record<string, string>) => ContractRouterClient<MeshClientContract>;

/**
 * Create an oRPC client for a remote mesh node.
 *
 * If `internalHeaders` is provided, every request sent by this client carries them. The pre-enrollment path passes
 * `{ "x-mesh-internal-key": <signed v1 token> }` so the peer's `requireInternalMesh()` middleware accepts the call. The
 * post-enrollment path passes the long-lived peer service token.
 */
export const createRemoteMeshClient: MeshClientFactory = (baseUrl, internalHeaders) => {
	const link = new OpenAPILink(meshClientRouter, {
		// v2 split the old single `url` in two: `url` is the base PATH (it must match the OpenAPI handler's mount path) and
		// `origin` is the scheme+host. `baseUrl` here is an origin (`http://host:port`).
		origin: baseUrl,
		fetch: (input, init) => {
			if (!internalHeaders) return fetch(input, init);
			// `Headers` already accepts every `HeadersInit` shape (record, tuple list, Headers), including a record whose
			// value is several strings for one name.
			const headers = new Headers("headers" in init ? init.headers : undefined);
			for (const [name, value] of Object.entries(internalHeaders)) headers.set(name, value);
			return fetch(input, { ...init, headers });
		},
	});
	return createORPCClient<ContractRouterClient<MeshClientContract>>(link);
};

export type MeshInitializationServiceShape = {
	/**
	 * Opens a typed oRPC session to a remote mesh node. Used for post-bootstrap operations (registerNode, listPeerSessions…).
	 *
	 * `peerServiceToken` is optional: without it only the public `ping` endpoint and the mesh-internal shared secret channel
	 * are usable; with it, all peer-to-peer mesh endpoints (`getLocalNode`, `listPeerSessions`, …) are reachable.
	 */
	readonly connectToMesh: (
		meshUrl: string,
		options?: { peerServiceToken?: string | null },
	) => Effect.Effect<MeshSetupSession, MeshPeerUrlInvalid | MeshPeerUnreachable>;
};

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
export function makeMeshInitializationService(createClient: MeshClientFactory = createRemoteMeshClient): MeshInitializationServiceShape {
	const reasonOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

	return {
		connectToMesh: (meshUrl, options = {}) =>
			Effect.gen(function* () {
				const origin = (yield* Effect.try({ try: () => new URL(meshUrl), catch: () => new MeshPeerUrlInvalid({}) })).origin;

				// The public `ping` endpoint validates connectivity: at bootstrap time there is neither a user session nor an
				// internal mesh key, so the authenticated `getLocalNode` would 401. Anything beyond reachability is deferred to
				// the post-enrollment steps where the local node has a valid `MeshSetupSession` client.
				yield* Effect.tryPromise({
					try: () => createClient(origin).ping({}),
					catch: (cause) => new MeshPeerUnreachable({ url: origin, reason: reasonOf(cause) }),
				});

				const peerServiceToken = options.peerServiceToken ?? "";
				const client = createClient(origin, peerServiceToken.length > 0 ? { "x-mesh-internal-key": peerServiceToken } : undefined);
				const remoteLocalNode = yield* Effect.tryPromise({
					try: () => client.getLocalNode({}),
					catch: (cause) => new MeshPeerUnreachable({ url: origin, reason: reasonOf(cause) }),
				});

				return {
					remoteNodeId: remoteLocalNode.nodeId,
					remoteBaseUrl: origin,
					client,
					peerServiceToken,
					// For convenience, report "never expires" when we don't have a token. Callers that need accurate expiry can
					// re-enroll and inspect `MeshBootstrapConfig`.
					peerServiceTokenExpiresAt:
						peerServiceToken.length > 0
							? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
							: new Date(0).toISOString(),
					close: () => Promise.resolve(),
				};
			}),
	};
}

export class MeshInitializationService extends Context.Service<MeshInitializationService, MeshInitializationServiceShape>()(
	"shared/MeshInitializationService",
) {}
