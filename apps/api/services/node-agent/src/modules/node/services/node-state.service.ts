import { Context, Effect } from 'effect'

import { domainError } from '@deployer/effect-core'
import {
    type MeshNodeConfig,
    type MeshNodeConfigureInput,
    type MeshNodeState,
    meshNodeConfigSchema,
} from '@deployer/node-agent-contracts'

import { AgentStore, type AgentStoreError } from '../../../local/agent-store'
import { NodeIdentity } from '../../mesh/services/node-identity.service'

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
    meshSharedSecret: null,
    meshSharedSecretUpdatedAt: null,
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
            return Effect.gen(function* () {
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
        }

        configure(patch: MeshNodeConfigureInput) {
            return Effect.gen(function* () {
                const store = yield* AgentStore
                const identity = yield* NodeIdentity
                const stored = yield* store.nodeConfig()
                const current =
                    stored === null ? null : yield* decode(stored.config)

                const now = new Date().toISOString()
                const next: MeshNodeConfig = {
                    ...(current ?? UNCONFIGURED),
                    ...patch,
                    // Server-owned: the first write is when the node was created, every write moves `updatedAt`.
                    configuredAt: current?.configuredAt ?? now,
                    updatedAt: now,
                }

                yield* store.putNodeConfig(
                    JSON.stringify(next),
                    Date.parse(now)
                )
                return {
                    agentId: identity.nodeId,
                    configured: true,
                    config: next,
                }
            })
        }
    }
}

const decode = (json: string) =>
    Effect.try({
        try: () => meshNodeConfigSchema.parse(JSON.parse(json)),
        catch: () => new NodeConfigUnreadable({}),
    })
