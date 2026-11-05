import { createHash } from 'node:crypto'

/**
 * The canonical hash an approval is bound to (`SEC-072`).
 *
 * Computed from the PROCEDURE and the identity of what it acts on — never from a free-form blob the caller can rearrange.
 * Two calls that would do the same thing produce the same hash; anything else produces a different one, which is what
 * stops "approve the staging deploy" being replayed as "deploy v9 to prod".
 *
 * Here rather than in each service: the peer that files the request and the guard that spends it must agree byte for byte,
 * and two copies of a canonicalisation is how they stop agreeing.
 */
export function actionHash(
    procedure: string,
    ...parts: readonly (string | number)[]
): string {
    return createHash('sha256')
        .update([procedure, ...parts.map(String)].join('\u0000'))
        .digest('hex')
}
