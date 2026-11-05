import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    configureSchemaCodecs,
    decryptSecret,
    encryptSecret,
    isSealedValue,
} from '@deployer/nest-schema/codecs/codec-registry'
import { findEncryptedColumns } from '@deployer/nest-schema/codecs/reseal'
import * as globalSchema from '@deployer/nest-schema/global'

import {
    bindEncryptionRoot,
    legacyRootFrom,
    registerSchemaCodecs,
    resolveSealer,
} from './schema-codecs'

/**
 * The key policy for NEW writes (SEC-016) and the compatibility contract with rows the old
 * codec wrote. Runs under the Bun runtime (the sealer uses `Uint8Array#toBase64`).
 */

const STRONG = 'kJ8vQ2mP9xLr4TnB7yHs5WcZ1dGfA3eU6iO0pNqMvXbY='
const OTHER_STRONG = 'Zr5tYw8Qe1Lk3Vb7Nc9Xs2Pd4Gh6Jf0AaMoIuTyRbEn='
const HEX_SECRET =
    '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

/** The OLD writer, verbatim: scrypt(key, randomSalt) + AES-256-GCM, `salt:iv:tag:data`. */
function oldEncrypt(text: string, key: Buffer): string {
    const salt = randomBytes(32)
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-gcm', scryptSync(key, salt, 32), iv)
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    return `${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`
}

describe('resolveSealer: the root is the platform secret, read at use time', () => {
    it('round-trips under a strong root (base64 is fine: no hex assumption)', () => {
        const sealer = resolveSealer(() => STRONG)
        const stored = sealer.seal('token')
        expect(stored.startsWith('enc:v1:')).toBe(true)
        expect(sealer.open(stored)).toBe('token')
    })

    it('reads the root when it is used, so a root that arrives after registration works', () => {
        let root: string | null = null
        const sealer = resolveSealer(() => root)

        expect(() => sealer.seal('x')).toThrowError(/Encryption root unavailable/)
        root = STRONG
        expect(sealer.open(sealer.seal('x'))).toBe('x')
    })

    it('has no fallback key in any environment: no secret means no sealing and no opening', () => {
        const sealer = resolveSealer(() => null)
        expect(() => sealer.seal('x')).toThrowError(/Encryption root unavailable/)
        expect(() => sealer.open('enc:v1:{}')).toThrowError(/Encryption root unavailable/)
    })

    it('a different root cannot open what another sealed', () => {
        const stored = resolveSealer(() => STRONG).seal('secret')
        expect(() => resolveSealer(() => OTHER_STRONG).open(stored)).toThrow()
    })

    it.each([
        ['too short', 'short'],
        ['a placeholder', 'your-secure-auth-secret-here-0123456789abcdef'],
        ['a known fallback', 'fallback-auth-secret-fallback-auth-secret'],
        ['no variety', 'a'.repeat(64)],
    ])('refuses a root that is %s', (_label, secret) => {
        expect(() => resolveSealer(() => secret).seal('x')).toThrow()
    })

    it('accepts the 64 hex characters a node generates for itself', () => {
        const generated = randomBytes(32).toString('hex')
        const sealer = resolveSealer(() => generated)
        expect(sealer.open(sealer.seal('v'))).toBe('v')
    })
})

describe('legacyRootFrom: what an upgraded install may bring along', () => {
    it('prefers DEPLOYER_ROOT_SECRET over AUTH_SECRET', () => {
        expect(
            legacyRootFrom({ DEPLOYER_ROOT_SECRET: STRONG, AUTH_SECRET: OTHER_STRONG })
        ).toBe(STRONG)
        expect(legacyRootFrom({ AUTH_SECRET: OTHER_STRONG })).toBe(OTHER_STRONG)
    })

    it('skips a weak value and falls through to the next, or to nothing', () => {
        expect(
            legacyRootFrom({ DEPLOYER_ROOT_SECRET: 'short', AUTH_SECRET: OTHER_STRONG })
        ).toBe(OTHER_STRONG)
        expect(legacyRootFrom({ AUTH_SECRET: 'fallback-auth-secret' })).toBeNull()
        expect(legacyRootFrom({ DEPLOYER_ROOT_SECRET: '   ' })).toBeNull()
        expect(legacyRootFrom({})).toBeNull()
    })
})

describe('registerSchemaCodecs: compatibility with rows written by the old codec', () => {
    beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('AUTH_SECRET', HEX_SECRET)
        bindEncryptionRoot(() => STRONG)
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        bindEncryptionRoot(() => null)
        // Leave the module-level registry in a harmless state for other suites in this worker.
        configureSchemaCodecs({
            encryption: { resolveKey: () => Buffer.alloc(32, 7) },
        })
    })

    it('reads legacy rows (key = AUTH_SECRET as hex) and writes only the sealed form', () => {
        const legacyRow = oldEncrypt(
            'old-github-private-key',
            Buffer.from(HEX_SECRET, 'hex')
        )

        registerSchemaCodecs()

        expect(isSealedValue(legacyRow)).toBe(false)
        expect(decryptSecret(legacyRow)).toBe('old-github-private-key')
        const fresh = encryptSecret('new-github-private-key')
        expect(isSealedValue(fresh)).toBe(true)
        expect(fresh).not.toContain('new-github')
        expect(decryptSecret(fresh)).toBe('new-github-private-key')
    })

    it('reads rows that were written under an EMPTY key (non-hex AUTH_SECRET), the SEC-016 case', () => {
        vi.stubEnv('AUTH_SECRET', STRONG) // base64: parsed as hex it is empty
        const legacyRow = oldEncrypt(
            'exposed-dns-token',
            Buffer.from(STRONG, 'hex')
        )
        expect(Buffer.from(STRONG, 'hex').length).toBe(0)

        registerSchemaCodecs()

        expect(decryptSecret(legacyRow)).toBe('exposed-dns-token')
    })

    it('registering needs no secret: sealing waits for the root and says so until it is bound', () => {
        bindEncryptionRoot(() => null)

        expect(() => {
            registerSchemaCodecs()
        }).not.toThrow()
        // The registry wraps the cause (and logs it); what matters is that it fails instead of writing plaintext.
        expect(() => encryptSecret('too early')).toThrowError('Failed to encrypt data')
    })
})

describe("the REAL schema's encrypted columns use the registry that registerSchemaCodecs configures", () => {
    /**
     * Regression guard. When `nest-schema`'s built chunks imported the registry through the
     * package's own name, Bun resolved that specifier to the SOURCE file (via the package's
     * tsconfig `paths`) while consumers got the DIST file: two copies of the module-level
     * registry, one configured and one not. Every real column then threw "used before the
     * encryption key was configured". Tables built inside a spec cannot catch that; the real
     * schema can.
     */
    beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'production')
        vi.stubEnv('AUTH_SECRET', HEX_SECRET)
        bindEncryptionRoot(() => STRONG)
        registerSchemaCodecs()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        bindEncryptionRoot(() => null)
        configureSchemaCodecs({
            encryption: { resolveKey: () => Buffer.alloc(32, 7) },
        })
    })

    it('finds the encrypted columns, so none is bound to an unconfigured copy of the registry', () => {
        const { targets, skipped } = findEncryptedColumns(globalSchema)

        expect(skipped).toEqual([])
        // 11 at the time of writing; the point is "all of them", not the exact count.
        expect(targets.length).toBeGreaterThanOrEqual(11)
        expect(targets.map((t) => `${t.table}.${t.column}`)).toEqual(
            expect.arrayContaining([
                'environment_variables.value',
                'dns_providers.credentials',
                'github_apps.private_key',
                'webhooks.secret',
            ])
        )
    })
})
