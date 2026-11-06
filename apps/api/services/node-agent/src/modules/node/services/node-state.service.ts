import { randomBytes } from 'node:crypto'

import { Context, Effect } from 'effect'

import { domainError } from '@deployer/effect-core'
import {
    type MeshNodeConfig,
    type MeshNodeConfigureInput,
    type MeshNodeSecrets,
    type MeshNodeState,
    meshNodeConfigSchema,
    withLegacyDefaults,
} from '@deployer/node-agent-contracts'

import { AgentStore, type AgentStoreError } from '../../../local/agent-store'
import { NodeIdentity } from '../../mesh/services/node-identity.service'
import { SecretRotationRefused } from '../secret-rotation.errors'
import { secretInventoryOf } from '../secret-inventory'

/** The stored node config is not a config this agent wrote: refuse it rather than serve a half-understood node. */
export class NodeConfigUnreadable extends domainError(
    'NodeConfigUnreadable',
    'dependency_missing'
)() {
    override publicMessage() {
        return "The node's stored configuration cannot be read"
    }
}

/** What a node looks like before anyone configured it. Nothing here is invented at boot: it is the shape a patch fills. */
const UNCONFIGURED: Omit<MeshNodeConfig, 'updatedAt'> = {
    nodeId: null,
    strategy: 'local',
    setupState: 'not_started',
    deployerVersion: null,
    upgradedAtVersion: null,
    databaseUrl: null,
    databaseProvisioning: null,
    meshUrlsSnapshot: [],
    swarmConfig: null,
    peerServiceToken: null,
    peerServiceTokenExpiresAt: null,
    platformSecret: null,
    platformSecretUpdatedAt: null,
    platformSecretGeneration: 1,
    platformSecretPrevious: [],
    scanConfig: null,
    mesh: null,
    postSetupFlags: null,
    configuredAt: null,
}

export type NodeStateShape = {
    /** This node's id and configuration; `config` stays null until something configures the node. */
    readonly state: () => Effect.Effect<
        MeshNodeState,
        NodeConfigUnreadable | AgentStoreError,
        AgentStore | NodeIdentity
    >
    /** What this node holds and what reads it, without a value: the input to the fleet's adoption view. */
    readonly secrets: () => Effect.Effect<
        MeshNodeSecrets,
        NodeConfigUnreadable | AgentStoreError,
        AgentStore | NodeIdentity
    >
    /**
     * Makes a new generation of the platform secret current: a fresh random value, the old one kept as an earlier generation.
     * Refused on a node that is not set up. Answers the generation, never a value.
     */
    readonly rotatePlatformSecret: () => Effect.Effect<
        { readonly generation: number },
        NodeConfigUnreadable | AgentStoreError | SecretRotationRefused,
        AgentStore | NodeIdentity
    >
    /**
     * Stops accepting an earlier generation on this node. The current generation is refused; a generation this node does not
     * hold is already retired, which is the state asked for. Answers the generation that is current.
     */
    readonly retirePlatformSecret: (
        generation: number
    ) => Effect.Effect<
        { readonly generation: number | null },
        NodeConfigUnreadable | AgentStoreError | SecretRotationRefused,
        AgentStore | NodeIdentity
    >
    /** Applies a patch and returns the result: the only way a node is created or changed. */
    readonly configure: (
        patch: MeshNodeConfigureInput
    ) => Effect.Effect<
        MeshNodeState,
        NodeConfigUnreadable | AgentStoreError,
        AgentStore | NodeIdentity
    >
}

/**
 * The node's own record, kept in the node's local database.
 *
 * A node is created by writing this row, never by an environment variable: the agent generates the id on first boot
 * and holds the row from then on, and the setup flow, the API or a future CLI configure it later through
 * `node.configure`. The write is a patch, so the callers never need to know what the others wrote.
 */
export class NodeState extends Context.Service<NodeState, NodeStateShape>()(
    'node-agent/NodeState'
) {
    static readonly live = class NodeStateImpl implements NodeStateShape {
        state() {
            return readState()
        }

        secrets() {
            return Effect.gen(function* () {
                const store = yield* AgentStore
                const identity = yield* NodeIdentity
                const stored = yield* store.nodeConfig()
                const config =
                    stored === null ? null : yield* decode(stored.config)
                return {
                    agentId: identity.nodeId,
                    secrets: secretInventoryOf(config),
                }
            })
        }

        rotatePlatformSecret() {
            return Effect.gen(function* () {
                const { config } = yield* readState()
                if (config === null) {
                    return yield* new SecretRotationRefused({
                        reason: 'This node is not set up yet, so it has no platform secret to rotate',
                    })
                }
                const earlier =
                    config.platformSecret === null
                        ? []
                        : [
                              {
                                  generation: config.platformSecretGeneration,
                                  value: config.platformSecret,
                              },
                              ...config.platformSecretPrevious,
                          ]
                const generation =
                    config.platformSecret === null
                        ? 1
                        : config.platformSecretGeneration + 1
                yield* applyPatch({
                    platformSecret: randomBytes(32).toString('hex'),
                    platformSecretUpdatedAt: new Date().toISOString(),
                    platformSecretGeneration: generation,
                    platformSecretPrevious: earlier,
                })
                return { generation }
            })
        }

        retirePlatformSecret(generation: number) {
            return Effect.gen(function* () {
                const { config } = yield* readState()
                if (config?.platformSecret === null || config === null) {
                    return yield* new SecretRotationRefused({
                        reason: 'This node holds no platform secret',
                    })
                }
                if (generation >= config.platformSecretGeneration) {
                    return yield* new SecretRotationRefused({
                        reason: 'The current generation cannot be retired: rotate first',
                    })
                }
                yield* applyPatch({
                    platformSecretPrevious: config.platformSecretPrevious.filter(
                        (entry) => entry.generation !== generation
                    ),
                })
                return { generation: config.platformSecretGeneration }
            })
        }

        configure(patch: MeshNodeConfigureInput) {
            return applyPatch(patch)
        }
    }
}

/** The node's record as its agent holds it. */
const readState = () =>
    Effect.gen(function* () {
        const store = yield* AgentStore
        const identity = yield* NodeIdentity
        const stored = yield* store.nodeConfig()
        if (stored === null)
            return {
                agentId: identity.nodeId,
                configured: false,
                config: null,
            } as const
        return {
            agentId: identity.nodeId,
            configured: true,
            config: yield* decode(stored.config),
        }
    })

/** A patch applied to the record: a named field replaces the stored one, an absent one keeps its value. */
const applyPatch = (patch: MeshNodeConfigureInput) =>
    Effect.gen(function* () {
        const store = yield* AgentStore
        const identity = yield* NodeIdentity
        const stored = yield* store.nodeConfig()
        const current = stored === null ? null : yield* decode(stored.config)

        const now = new Date().toISOString()
        const next: MeshNodeConfig = {
            ...(current ?? UNCONFIGURED),
            ...patch,
            // Server-owned: the first write is when the node was created, every write moves `updatedAt`.
            configuredAt: current?.configuredAt ?? now,
            updatedAt: now,
        }

        yield* store.putNodeConfig(JSON.stringify(next), Date.parse(now))
        return {
            agentId: identity.nodeId,
            configured: true,
            config: next,
        }
    })

const decode = (json: string) =>
    Effect.try({
        try: () =>
            meshNodeConfigSchema.parse(withLegacyDefaults(JSON.parse(json))),
        catch: () => new NodeConfigUnreadable({}),
    })
