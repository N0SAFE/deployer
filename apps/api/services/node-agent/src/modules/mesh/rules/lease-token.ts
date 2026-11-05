import { createHmac, timingSafeEqual } from 'node:crypto'

export type LeaseClaims = {
    readonly replicaId: string
    readonly callerId: string
    /** Epoch ms. */
    readonly expiresAt: number
}

export type LeaseVerdict =
    | { readonly ok: true; readonly claims: LeaseClaims }
    | {
          readonly ok: false
          readonly reason:
              'malformed' | 'bad-signature' | 'expired' | 'wrong-replica'
      }

const encode = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
const decode = (text: string) => Buffer.from(text, 'base64url').toString('utf8')
const sign = (payload: string, secret: string) =>
    createHmac('sha256', secret).update(payload).digest('base64url')

/** The grant a `MESH_DIRECT` answer carries. The replica checks it; nothing else about the caller is trusted. */
export function signLease(claims: LeaseClaims, secret: string): string {
    const payload = encode(JSON.stringify(claims))
    return `${payload}.${sign(payload, secret)}`
}

export function verifyLease(
    token: string,
    secret: string,
    replicaId: string,
    now: number
): LeaseVerdict {
    const [payload, signature, extra] = token.split('.')
    if (!payload || !signature || extra !== undefined) {
        return { ok: false, reason: 'malformed' }
    }

    const expected = Buffer.from(sign(payload, secret))
    const actual = Buffer.from(signature)
    if (
        expected.length !== actual.length ||
        !timingSafeEqual(expected, actual)
    ) {
        return { ok: false, reason: 'bad-signature' }
    }

    let claims: LeaseClaims
    try {
        claims = JSON.parse(decode(payload)) as LeaseClaims
    } catch {
        return { ok: false, reason: 'malformed' }
    }

    if (claims.expiresAt <= now) {
        return { ok: false, reason: 'expired' }
    }
    if (claims.replicaId !== replicaId) {
        return { ok: false, reason: 'wrong-replica' }
    }
    return { ok: true, claims }
}
