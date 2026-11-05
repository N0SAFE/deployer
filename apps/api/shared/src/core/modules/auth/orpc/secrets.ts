import { Context, Effect } from 'effect'

import { runSyncUnwrapped } from '@deployer/effect-core'
import { apiEnvSchema, type ApiEnv as Env } from '@deployer/env'
import { makeLenientEnvironment } from '@deployer/environment'

/** The API's environment, read where a middleware needs a secret (the schema stays in this app, not in the package). */
const readEnv = <K extends keyof Env>(key: K): Env[K] =>
    runSyncUnwrapped(makeLenientEnvironment(apiEnvSchema)).get(key)

const secretFrom = (value: unknown): string | null => {
    const text = typeof value === 'string' ? value : value?.toString()
    const trimmed = text?.trim()
    return trimmed === undefined || trimmed === '' ? null : trimmed
}

/** Where a secret comes from. A service, so a spec supplies one with a Layer and a node can source it from its own store. */
export type SecretShape = { readonly get: () => Effect.Effect<string | null> }

/** The mesh shared secret every peer's token is verified against: this node's own stored secret (`node_config`), never the environment. */
export class MeshSecret extends Context.Service<MeshSecret, SecretShape>()('auth/MeshSecret') {}

/** The platform secret system-actor claims are signed with (`BETTER_AUTH_SECRET`, else `AUTH_SECRET`). */
export class PlatformSecret extends Context.Service<PlatformSecret, SecretShape>()('auth/PlatformSecret') {}

// shortcut: the platform secret still comes from the environment (`BETTER_AUTH_SECRET`, else `AUTH_SECRET`); upgrade when it is
// generated on a node's first boot, stored in its local config and shared with the other nodes (SEC-100). The mesh secret
// already is: see `MeshSecret` in `node-state.module.ts`.
export const envPlatformSecret: SecretShape = {
    get: () =>
        Effect.sync(() => secretFrom(readEnv('BETTER_AUTH_SECRET')) ?? secretFrom(readEnv('AUTH_SECRET'))),
}
