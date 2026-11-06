import { scryptSync } from 'crypto'

import { Logger } from '@nestjs/common'
import { Redacted } from 'effect'

import { runSyncUnwrapped } from '@deployer/effect-core'
import { makeSyncSecretBox, validateRootSecret } from '@deployer/effect-infra'
import { validateApiEnvPath } from '@deployer/env'
import {
    configureSchemaCodecs,
    type EncryptedTextKeyProvider,
    type EncryptedTextSealer,
    type TraefikConfigCodec,
} from '@deployer/nest-schema/codecs/codec-registry'

import { TraefikConfigBuilder } from '../../core/modules/traefik/config-builder/builders'

const logger = new Logger('SchemaCodecs')

/**
 * The APP half of the schema codecs: where the encryption key comes from, and
 * which traefik builder the config column uses.
 *
 * WHY THIS LIVES IN THE APP
 * Both answers are application POLICY, not schema mechanics. The key policy in
 * particular is security-sensitive: a missing `AUTH_SECRET` is a HARD BOOT
 * FAILURE in production (an in-source fallback key would make every stored
 * ciphertext decryptable by anyone with repo access). A shared schema package
 * cannot make that call. The sealing root is the node's platform secret; only the
 * LEGACY reader below still reads the environment.
 *
 * The package declares what it needs; this file is what it gets.
 */

/**
 * LEGACY key: used ONLY to read rows written before the sealing codec existed
 * (`salt:iv:tag:data`). Nothing is written with it any more.
 *
 * It is deliberately left byte-for-byte as it was, including its flaw: the key is
 * `Buffer.from(AUTH_SECRET, "hex")`, which is EMPTY for a non-hex secret (SEC-016). Old
 * rows must stay readable exactly as they were written; the reseal command rewrites them
 * under the real key, and this provider is deleted once it reports zero legacy rows.
 *
 * Validated through the shared env schema so a malformed secret fails with the
 * schema's message rather than a cryptic crypto error later.
 */
const legacyKeyProvider: EncryptedTextKeyProvider = {
    resolveKey(): Buffer {
        // `AUTH_SECRET` is OPTIONAL in the shared env schema, so the validated
        // value can legitimately be undefined — that is the "not configured"
        // case the fallback below handles, not an invariant to assert.
        const secret = process.env.AUTH_SECRET
            ? validateApiEnvPath(process.env.AUTH_SECRET, 'AUTH_SECRET')
            : undefined
        if (secret !== undefined && secret !== '') {
            return Buffer.from(secret, 'hex')
        }

        // Fail fast: never run production with an in-source fallback key — any
        // ciphertext written under it is trivially decryptable.
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'Encryption key (AUTH_SECRET) is required in production — refusing to boot'
            )
        }

        logger.warn(
            '⚠️  AUTH_SECRET not found. PRODUCTION WILL REFUSE TO BOOT — this shows because ' +
                'non-production environments (dev/test) use a temporary key, which is NOT secure. ' +
                "Generate a key with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
        )
        return scryptSync('temporary-fallback-key', 'salt', 32)
    },
}

/** The platform secret as the codecs need it: the generation new values are sealed under, and the earlier ones still opened. */
export type SealingRing = {
    readonly generation: number
    readonly value: string
    readonly previous: readonly { readonly generation: number; readonly value: string }[]
}

/** Where the sealing ring comes from, read at USE time: null means this node has no platform secret yet. */
export type RootSource = () => SealingRing | null

/**
 * Build the sealing codec: the root that protects NEW writes (SEC-016) is the node's platform secret (`node_config`), read
 * when a value is sealed or opened rather than when the codecs are registered. Registration runs at module load, before
 * the node's config can be read; a drizzle column codec is synchronous, so the source is a synchronous reader of the
 * snapshot the node keeps.
 *
 * The secret is a ring (SEC-101): new values are sealed under the current generation (`column:N`), and a value sealed under
 * an earlier generation still opens while that generation is accepted, derived from its own root. Retiring a generation
 * is what makes its rows unreadable, so it is an operator's act, after the reseal.
 *
 * There is no fallback key, in any environment: a node with no platform secret cannot seal or open anything, and says so
 * (an in-source or public key would make every ciphertext readable by whoever has the repository). A weak root is refused
 * the same way (`WeakRootSecret`), including one adopted from an old environment variable.
 */
export function resolveSealer(source: RootSource): EncryptedTextSealer {
    let current: { readonly key: string; readonly sealer: EncryptedTextSealer } | null =
        null
    const sealer = (): EncryptedTextSealer => {
        const ring = source()
        if (ring === null || ring.value === '') {
            throw new Error(
                'Encryption root unavailable: this node has no platform secret yet (its node_config is not set up, or not read yet)'
            )
        }
        const key = JSON.stringify(ring)
        if (current?.key !== key) current = { key, sealer: sealerFor(ring) }
        return current.sealer
    }
    return {
        seal: (plaintext) => sealer().seal(plaintext),
        open: (stored) => sealer().open(stored),
    }
}

function sealerFor(ring: SealingRing): EncryptedTextSealer {
    const roots: Record<number, Redacted.Redacted> = { [ring.generation]: Redacted.make(ring.value) }
    for (const entry of ring.previous) roots[entry.generation] = Redacted.make(entry.value)
    const box = runSyncUnwrapped(
        makeSyncSecretBox({
            rootSecret: Redacted.make(ring.value),
            rootsByGeneration: roots,
            generations: {
                column: {
                    current: ring.generation,
                    accepted: Object.keys(roots).map(Number),
                },
            },
        })
    )
    // A drizzle column codec is synchronous, so the Effects run here, at the codec boundary.
    return {
        seal: (plaintext) => runSyncUnwrapped(box.seal(plaintext)),
        open: (stored) => runSyncUnwrapped(box.open(stored)),
    }
}

/** The slice of the environment an upgrade may import its old encryption root from. */
export type LegacyRootEnv = {
    readonly DEPLOYER_ROOT_SECRET?: string | undefined
    readonly AUTH_SECRET?: string | undefined
}

/**
 * The root an install used BEFORE the platform secret existed, if it was a usable one.
 *
 * shortcut: a one-time import so an upgraded install keeps reading what it already stored (and keeps its sessions valid):
 * the node adopts it as its platform secret the first time one is generated, instead of minting a new one that no existing
 * ciphertext opens under. Weak or placeholder values are NOT adopted (they would be refused as a root anyway). Delete once
 * no install predates the platform secret.
 */
export function legacyRootFrom(env: LegacyRootEnv): string | null {
    for (const candidate of [env.DEPLOYER_ROOT_SECRET, env.AUTH_SECRET]) {
        const value = candidate?.trim()
        if (value !== undefined && value !== '' && validateRootSecret(value) === undefined) {
            return value
        }
    }
    return null
}

let boundRoot: RootSource = () => null

/** Tells the codecs where the node's platform secret is. Called once the node can read it (see `NodeStateModule`). */
export function bindEncryptionRoot(source: RootSource): void {
    boundRoot = source
}

/**
 * The traefik config builder, as the schema's `jsonb` column needs it.
 *
 * `load` accepts both a stored JSON string and an already-parsed object, which
 * is what the column receives depending on the driver path.
 */
const traefikConfigCodec: TraefikConfigCodec<TraefikConfigBuilder> = {
    // `load` accepts a stored JSON string OR an already-parsed object, which is
    // what the column receives depending on the driver path.
    load: (value: string | object) =>
        TraefikConfigBuilder.load(
            typeof value === 'string' ? value : JSON.stringify(value)
        ),
    empty: () => new TraefikConfigBuilder(),
    build: (builder: TraefikConfigBuilder) => builder.build(),
}

/**
 * Wire the schema codecs. MUST run before the first query touches an encrypted
 * or traefik-config column; the package throws a named error if it does not.
 */
export function registerSchemaCodecs(): void {
    configureSchemaCodecs({
        // Reads of rows written by the old codec.
        encryption: legacyKeyProvider,
        // Every write, and every read of a sealed value, under the node's platform secret (bound once it can be read).
        sealing: resolveSealer(() => boundRoot()),
        traefik: traefikConfigCodec,
    })
}
