import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Default replay window: 30 seconds.
 *
 * A request whose `X-Mesh-Internal-Key` token was signed more than this many
 * milliseconds ago is rejected, even if the HMAC is valid. Configurable at
 * runtime via the `MESH_REPLAY_WINDOW_MS` environment variable.
 */
const DEFAULT_REPLAY_WINDOW_MS = 30_000;

/**
 * In-memory rolling nonce set.
 *
 * Maps nonce → unix-ms timestamp of when it was first seen. Entries are evicted
 * lazily whenever a verification call fires, once the entry is older than the
 * replay window. This means memory is bounded by (request-rate × window), which
 * is tiny for internal cluster traffic.
 */
const seenNonces = new Map<string, number>();

function evictExpiredNonces(windowMs: number): void {
    const cutoff = Date.now() - windowMs;
    for (const [nonce, seenAt] of seenNonces.entries()) {
        if (seenAt < cutoff) {
            seenNonces.delete(nonce);
        }
    }
}

/**
 * Generate a signed mesh authentication token.
 *
 * Format: `v1.<timestamp_ms>.<nonce_hex>.<hmac_hex>`
 *
 * - `timestamp_ms` — `Date.now()` as a decimal string (used for replay-window check on receiver)
 * - `nonce_hex`    — 16 cryptographically random bytes as lowercase hex (uniqueness guarantee)
 * - `hmac_hex`     — HMAC-SHA256(`secret`, `v1|<timestamp_ms>|<nonce_hex>`) as lowercase hex
 *
 * The token must be passed in the `X-Mesh-Internal-Key` header. Recipients call
 * {@link verifyMeshToken} which also checks the replay window and deduplicates nonces.
 */
export function signMeshToken(secret: string): string {
    const ts = String(Date.now());
    const nonce = randomBytes(16).toString("hex");
    const msg = `v1|${ts}|${nonce}`;
    const sig = createHmac("sha256", secret).update(msg).digest("hex");
    return `v1.${ts}.${nonce}.${sig}`;
}

/**
 * Verify a mesh authentication token produced by {@link signMeshToken}.
 *
 * Checks (in order, all must pass):
 * 1. Token is present and has exactly four `.`-delimited parts.
 * 2. Version prefix is `v1`.
 * 3. Timestamp is within `windowMs` of `Date.now()` (default 30 s).
 * 4. HMAC matches (timing-safe comparison).
 * 5. Nonce has not been seen within the current window (replay prevention).
 *
 * On success, the nonce is recorded so subsequent calls with the same token fail.
 *
 * @returns `true` if all checks pass, `false` otherwise (deliberately non-specific).
 */
export function verifyMeshToken(
    token: string | null | undefined,
    secret: string,
    windowMs = DEFAULT_REPLAY_WINDOW_MS,
): boolean {
    if (!token) return false;

    const parts = token.split(".");
    if (parts.length !== 4) return false;

    const [version, tsStr, nonce, sig] = parts as [string, string, string, string];

    if (version !== "v1") return false;

    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return false;

    if (Math.abs(Date.now() - ts) > windowMs) return false;

    // HMAC verification (timing-safe)
    const msg = `v1|${tsStr}|${nonce}`;
    const expected = createHmac("sha256", secret).update(msg).digest();
    let actual: Buffer;
    try {
        actual = Buffer.from(sig, "hex");
    } catch {
        return false;
    }
    if (actual.length !== expected.length) return false;
    if (!timingSafeEqual(expected, actual)) return false;

    // Nonce replay guard
    evictExpiredNonces(windowMs);
    if (seenNonces.has(nonce)) return false;
    seenNonces.set(nonce, Date.now());

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Peer service tokens
//
// These are issued when a new node successfully consumes a join grant on an
// existing mesh. The token is bound to a specific `nodeId` so that:
//   - The holder can authenticate to peer-to-peer mesh endpoints on other
//     nodes in the cluster (sends it as `X-Mesh-Internal-Key` header).
//   - The peer can extract the calling node's identity from the token
//     and attribute operations to it (replaces the need for a Better Auth
//     user session on the calling node).
//
// Unlike the per-request `signMeshToken`/`verifyMeshToken` (which uses
// fresh nonces and a 30s replay window), peer service tokens are
// **long-lived** and do NOT use a nonce set — they are re-issued on every
// enrollment / re-enrollment and stored in the caller's persistent
// `NodeConfigRepository`. They expire at `expiresAtMs` (default 30 days).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default lifetime for a peer service token (30 days).
 *
 * Peer service tokens are persisted in the caller's `NodeConfigRepository`
 * and re-issued on every enrollment / re-enrollment. They're not meant to
 * expire during normal operation; the lifetime is a safety net for a
 * compromised token.
 */
const DEFAULT_PEER_SERVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Derive a node-specific secret from the shared mesh secret and a nodeId.
 *
 * This binds the peer service token to a specific node: a token signed
 * for node A cannot be replayed as if it were issued for node B. The
 * `MESH_PEER_TOKEN_DOMAIN` is mixed in to prevent accidental collision
 * with other HMAC uses of the same shared secret.
 */
function deriveNodeSecret(sharedSecret: string, nodeId: string): string {
    return createHmac("sha256", sharedSecret)
        .update(`mesh-peer-service-token|v1|${nodeId}`)
        .digest("hex");
}

/**
 * Issue a peer service token for a specific node.
 *
 * Format: `v2.<issued_at_ms>.<expires_at_ms>.<nodeId>.<sig_hex>`
 *
 * - `issued_at_ms`   — `Date.now()` as a decimal string
 * - `expires_at_ms`  — unix-ms when this token stops being accepted
 * - `nodeId`         — the node this token authenticates as (UUID)
 * - `sig_hex`        — HMAC-SHA256(node-specific secret,
 *                        `v2|<issued_at_ms>|<expires_at_ms>|<nodeId>`)
 *
 * The token is opaque to the caller; the bearer is supposed to send it
 * verbatim in the `X-Mesh-Internal-Key` header.
 */
export function signPeerServiceToken(
    sharedSecret: string,
    nodeId: string,
    now: number = Date.now(),
    ttlMs: number = DEFAULT_PEER_SERVICE_TOKEN_TTL_MS,
): { token: string; expiresAt: string } {
    const issuedAtMs = now;
    const expiresAtMs = now + ttlMs;
    const nodeSecret = deriveNodeSecret(sharedSecret, nodeId);
    const msg = `v2|${issuedAtMs}|${expiresAtMs}|${nodeId}`;
    const sig = createHmac("sha256", nodeSecret).update(msg).digest("hex");
    return {
        token: `v2.${issuedAtMs}.${expiresAtMs}.${nodeId}.${sig}`,
        expiresAt: new Date(expiresAtMs).toISOString(),
    };
}

/**
 * Verify a peer service token. On success, returns the calling node's
 * identity; on any failure, returns `null` (deliberately non-specific).
 *
 * Checks:
 * 1. Token is present and has exactly five `.`-delimited parts.
 * 2. Version prefix is `v2`.
 * 3. `nodeId` is a syntactically valid UUID (defense in depth — the
 *    peer also checks the nodeId exists in `cluster_nodes`).
 * 4. `issued_at_ms` and `expires_at_ms` are finite integers.
 * 5. `expires_at_ms` is in the future.
 * 6. HMAC matches (timing-safe), using the node-specific secret derived
 *    from the shared secret and the claimed nodeId.
 */
export interface VerifiedPeerToken {
    nodeId: string;
    expiresAtMs: number;
    issuedAtMs: number;
}

export function verifyPeerServiceToken(
    token: string | null | undefined,
    sharedSecret: string,
    now: number = Date.now(),
): VerifiedPeerToken | null {
    if (!token) return null;
    if (!token.startsWith("v2.")) return null;

    const parts = token.split(".");
    if (parts.length !== 5) return null;

    const [version, issuedAtStr, expiresAtStr, nodeId, sig] = parts as [
        string, string, string, string, string,
    ];

    if (version !== "v2") return null;

    const issuedAtMs = Number(issuedAtStr);
    const expiresAtMs = Number(expiresAtStr);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return null;
    if (expiresAtMs <= now) return null;

    // UUID v4 (case-insensitive). Matches exactly the same shape we accept
    // for `MESH_NODE_ID` in the rest of the codebase.
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidLike.test(nodeId)) return null;

    const nodeSecret = deriveNodeSecret(sharedSecret, nodeId);
    const msg = `v2|${issuedAtStr}|${expiresAtStr}|${nodeId}`;
    const expected = createHmac("sha256", nodeSecret).update(msg).digest();

    let actual: Buffer;
    try {
        actual = Buffer.from(sig, "hex");
    } catch {
        return null;
    }
    if (actual.length !== expected.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;

    return { nodeId, issuedAtMs, expiresAtMs };
}

/**
 * Generate a cryptographically random mesh shared secret.
 *
 * The secret is a 32-byte hex string (64 hex chars), suitable for use
 * as the `MESH_STREAM_SHARED_SECRET` or for persisting in the local
 * `node_config` table as `meshSharedSecret`.
 *
 * This is called once at setup time (local bootstrap) and stored in the
 * local SQLite database. The same secret is then shared with joining
 * nodes during the `consumeJoinGrant` handshake so every node in the
 * cluster can validate peer credentials with the same key material.
 */
export function generateMeshSharedSecret(): string {
    return randomBytes(32).toString("hex");
}
