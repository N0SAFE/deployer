import { Effect } from 'effect'

import {
    agentLink,
    createMeshClient,
    type PooledLink,
    nodeAgentLink,
} from '@deployer/mesh-client'

import type { ClientContext, ClientLink } from '@orpc/client'

/**
 * This node's record, as its agent holds it. A structural mirror of the agent's contract: `shared` does not depend on
 * the agent's contract package.
 */
export type NodeRecordConfig = {
    readonly nodeId: string | null
    readonly strategy: 'local' | 'remote'
    readonly setupState:
        | 'not_started'
        | 'setup_in_progress'
        | 'setup_done'
        | 'upgrade_pending'
        | 'upgrade_in_progress'
        | 'upgrade_failed'
    readonly deployerVersion: string | null
    readonly upgradedAtVersion: string | null
    readonly databaseUrl: string | null
    readonly databaseProvisioning: 'local' | 'external' | null
    readonly meshUrlsSnapshot: readonly string[]
    readonly swarmConfig: {
        readonly mode: 'create' | 'join'
        readonly policy: 'auto' | 'manager' | 'worker'
        readonly advertiseAddr: string | null
        readonly joinToken: string | null
        readonly joinAddrs: readonly string[]
    } | null
    readonly peerServiceToken: string | null
    readonly peerServiceTokenExpiresAt: string | null
    readonly meshSharedSecret: string | null
    readonly meshSharedSecretUpdatedAt: string | null
    readonly scanConfig: {
        readonly autoScan: boolean
        readonly scanners: readonly ('trivy' | 'grype' | 'dive')[]
    } | null
    readonly mesh: {
        readonly nodeServerUrl: string | null
        readonly bootstrapPeers: string | null
        readonly syncIntervalMs: number
        readonly trustStrictMinAckRatio: string
        readonly trustStrictMaxAckAgeSeconds: number
        readonly trustStrictRolloutWaveSize: number
        readonly trustStrictAutoRollback: boolean
        readonly controlEnvelopeTrustRequired: boolean
    } | null
    readonly postSetupFlags: Readonly<Record<string, string>> | null
    readonly configuredAt: string | null
    readonly updatedAt: string
}

export type NodeRecord = {
    /** The agent's own identity on the mesh, generated on its first boot. */
    readonly agentId: string
    readonly configured: boolean
    readonly config: NodeRecordConfig | null
}

/** The two procedures this uses; the agent serves them on the node door only. */
type AgentNodeClient = {
    readonly node: {
        readonly state: (input: Record<string, never>) => Promise<NodeRecord>
        readonly configure: (
            input: Partial<NodeRecordConfig>
        ) => Promise<NodeRecord>
    }
}

export type NodeRecordOptions = {
    /** The agent's local socket. Defaults to the node's agent (`nodeAgentLink`). */
    readonly socketPath?: string
    /** Tests inject a link instead of opening a socket. */
    readonly link?: ClientLink<ClientContext>
    /** How long to wait for the agent before treating it as absent. */
    readonly timeoutMs?: number
}

/**
 * Reads this node's record from its agent, which owns the node's local database.
 *
 * Resolves null — never throws — when the node has no agent, the agent does not answer, or it is an agent that predates
 * the record: the caller then falls back to the local database it used before. The socket is local, so a boot waits
 * for at most `timeoutMs`.
 */
export async function readNodeRecord(
    options: NodeRecordOptions = {}
): Promise<NodeRecord | null> {
    return callAgent(options, (client) => client.node.state({}))
}

/** Writes a patch of the node's record through its agent. Resolves the resulting record, or null when it did not answer. */
export async function writeNodeRecord(
    patch: Partial<NodeRecordConfig>,
    options: NodeRecordOptions = {}
): Promise<NodeRecord | null> {
    return callAgent(options, (client) => client.node.configure(patch))
}

/** The record's platform node id, or null when the node has not been configured yet (or the agent is silent). */
export async function readPlatformNodeId(
    options: NodeRecordOptions = {}
): Promise<string | null> {
    return (await readNodeRecord(options))?.config?.nodeId ?? null
}

async function callAgent(
    options: NodeRecordOptions,
    call: (
        client: ReturnType<typeof createMeshClient<AgentNodeClient>>
    ) => Effect.Effect<NodeRecord, unknown>
): Promise<NodeRecord | null> {
    const owned = options.link === undefined
    const link =
        options.link ??
        (options.socketPath === undefined
            ? nodeAgentLink()
            : agentLink(options.socketPath))
    if (link === undefined) return null

    try {
        return await withTimeout(
            Effect.runPromise(call(createMeshClient<AgentNodeClient>(link))),
            options.timeoutMs ?? 1_000
        )
    } catch {
        return null
    } finally {
        if (owned)
            await (link as PooledLink<ClientContext>)
                .closeAll()
                .catch(() => undefined)
    }
}

const withTimeout = async <A>(
    promise: Promise<A>,
    timeoutMs: number
): Promise<A> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(
                        new Error(
                            `the node's agent did not answer within ${String(timeoutMs)} ms`
                        )
                    )
                }, timeoutMs)
            }),
        ])
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}
