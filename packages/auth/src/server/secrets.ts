import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * Compares two secrets without leaking which byte differed, or how long the guess was.
 *
 * `===` on a secret is a timing oracle: V8 compares string internals and stops at the first difference, so an attacker
 * can recover a prefix byte by byte. Hashing both sides first makes the comparison fixed-length, and `timingSafeEqual`
 * makes it constant-time — the length of the guess is not observable either, because the digest is always 32 bytes.
 *
 * An empty or absent expected value is never a match: a missing configuration must not authenticate anyone, which is
 * also what makes `secretsMatch(undefined, undefined)` safe by construction.
 */
export function secretsMatch(
    presented: string | null | undefined,
    expected: string | null | undefined
): boolean {
    if (expected === undefined || expected === null || expected.length === 0)
        return false
    if (presented === undefined || presented === null) return false

    const digestOf = (value: string): Buffer =>
        createHash('sha256').update(value, 'utf8').digest()
    return timingSafeEqual(digestOf(presented), digestOf(expected))
}

/** `Authorization: Bearer <token>` → `<token>`; anything else (including no header) → `null`. */
export function bearerToken(header: string | null | undefined): string | null {
    if (header === undefined || header === null) return null
    const [scheme, ...rest] = header.trim().split(/\s+/u)
    if (scheme?.toLowerCase() !== 'bearer') return null
    const token = rest.join(' ')
    return token.length === 0 ? null : token
}
