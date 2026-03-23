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
