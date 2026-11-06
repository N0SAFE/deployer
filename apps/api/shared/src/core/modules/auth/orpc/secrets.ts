import { Context, type Effect } from 'effect'

/** Where a secret comes from. A service, so a spec supplies one with a Layer and a node can source it from its own store. */
export type SecretShape = { readonly get: () => Effect.Effect<string | null> }

/** The mesh shared secret every peer's token is verified against: this node's own stored secret (`node_config`), never the environment. */
export class MeshSecret extends Context.Service<MeshSecret, SecretShape>()('auth/MeshSecret') {}

/**
 * The platform secret system-actor claims are signed and verified with: generated on this node's first boot and stored in
 * `node_config`, never the environment (`provide` it from `NodeStateModule`).
 */
export type PlatformSecretShape = SecretShape & {
    /**
     * Every value that may still be presented, the current one first: what a VERIFIER tries (system-actor claims, the ingress
     * token). A rotation keeps the earlier generations here until an operator retires them, so nothing signed just before it
     * stops working. A signer uses `get()`.
     */
    readonly accepted: () => Effect.Effect<readonly string[]>
}

export class PlatformSecret extends Context.Service<PlatformSecret, PlatformSecretShape>()('auth/PlatformSecret') {}
