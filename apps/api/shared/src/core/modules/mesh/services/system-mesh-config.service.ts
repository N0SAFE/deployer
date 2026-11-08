import { Context, Effect } from 'effect'

import type { ServiceLifecycleShape } from '@deployer/nest-effect'
import type {
    LocalDatabaseError,
    NodeConfigRepositoryShape,
} from '@deployer/node-state'

import {
    readNodeRecord,
    writeNodeRecord,
    type NodeRecord,
    type NodeRecordConfig,
} from './node-record.client'

import type {
    NodeMeshConfigRepositoryShape,
    NodeMeshConfigRow,
} from '../repositories/node-mesh-config.repository'

/** What the agent's record says about this node's mesh: the section `node.configure` writes. */
type AgentMeshConfig = NonNullable<NonNullable<NodeRecord['config']>['mesh']>

/** The mesh row as a patch of the agent's record: only the mesh section, nothing of the node config itself. */
const meshConfigPatch = (
    row: NodeMeshConfigRow
): Partial<NodeRecordConfig> => ({
    mesh: {
        nodeServerUrl: row.nodeServerUrl ?? null,
        bootstrapPeers: row.bootstrapPeersEncrypted ?? null,
        syncIntervalMs: row.syncIntervalMs,
        trustStrictMinAckRatio: row.trustStrictMinAckRatio,
        trustStrictMaxAckAgeSeconds: row.trustStrictMaxAckAgeSeconds,
        trustStrictRolloutWaveSize: row.trustStrictRolloutWaveSize,
        trustStrictAutoRollback: row.trustStrictAutoRollback,
        controlEnvelopeTrustRequired: row.controlEnvelopeTrustRequired,
    },
})

export type MeshConfigTrustKeys = {
    keyId: string
    algorithm: 'HS256' | 'HS512'
    secret: string
    status: 'active' | 'rotated'
}

const DEFAULT_SYNC_INTERVAL_MS = 10_000
const DEFAULT_TRUST_STRICT_MIN_ACK_RATIO = '1'
const DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS = 300
const DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE = 3
const DEFAULT_TRUST_STRICT_AUTO_ROLLBACK = false
const DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED = false

/** What can fail while the node's mesh configuration is resolved at boot. */
export type MeshConfigResolutionFailure = LocalDatabaseError

/**
 * The node's mesh configuration, resolved ONCE at boot (`onModuleInit`), so a getter never awaits (or queries) on a request
 * path: the getters are plain reads of that resolved snapshot (defaults, unpersisted, for a getter that runs before it).
 */
export type SystemMeshConfigServiceShape = ServiceLifecycleShape & {
    /**
     * Takes the record this node's agent serves and resolves what depends on it. Public so a test can supply a record without
     * a socket; `onModuleInit` is its only production caller.
     */
    readonly applyAgentRecord: (
        record: NodeRecord | null
    ) => Effect.Effect<void, MeshConfigResolutionFailure>
    /**
     * This node's platform id, or `""` when the node is not configured yet. Nothing invents one: an unconfigured node has no
     * id, and no environment variable is read here.
     */
    readonly getNodeId: () => string
    readonly getStreamSharedSecret: () => string | null
    readonly getNodeServerUrl: () => string | null
    readonly getControlEnvelopeTrustKeys: () => Map<string, MeshConfigTrustKeys>
    readonly getBootstrapPeers: () => string | null
    readonly getSyncIntervalMs: () => number
    readonly getTrustStrictMinAckRatio: () => number
    readonly getTrustStrictMaxAckAgeSeconds: () => number
    readonly getTrustStrictRolloutWaveSize: () => number
    readonly getTrustStrictAutoRollback: () => boolean
    readonly getControlEnvelopeTrustRequired: () => boolean
}

/** What the service is built from. */
export type SystemMeshConfigOptions = {
    readonly nodeConfig: NodeConfigRepositoryShape
    readonly meshConfigs: NodeMeshConfigRepositoryShape
    /** `APP_URL` and `MESH_BOOTSTRAP_PEERS`, read when the config is first resolved. */
    readonly env: {
        readonly appUrl: () => string | undefined
        readonly bootstrapPeers: () => string | undefined
    }
    /** This node's agent record; both calls resolve null (never throw) when the agent is absent or too old. */
    readonly agent?: {
        readonly read: () => Promise<NodeRecord | null>
        readonly write: (patch: Partial<NodeRecordConfig>) => Promise<unknown>
    }
}

/** The agent's mesh section as the row the rest of the service reads, so no getter has two shapes to handle. */
const rowFromAgentMesh = (mesh: AgentMeshConfig): NodeMeshConfigRow => {
    const now = new Date().toISOString()
    return {
        id: 1,
        nodeServerUrl: mesh.nodeServerUrl,
        bootstrapPeersEncrypted: mesh.bootstrapPeers,
        syncIntervalMs: mesh.syncIntervalMs,
        trustStrictMinAckRatio: mesh.trustStrictMinAckRatio,
        trustStrictMaxAckAgeSeconds: mesh.trustStrictMaxAckAgeSeconds,
        trustStrictRolloutWaveSize: mesh.trustStrictRolloutWaveSize,
        trustStrictAutoRollback: mesh.trustStrictAutoRollback,
        controlEnvelopeTrustRequired: mesh.controlEnvelopeTrustRequired,
        createdAt: now,
        updatedAt: now,
    }
}

const defaultRow = (
    overrides: Partial<NodeMeshConfigRow> = {}
): NodeMeshConfigRow => {
    const now = new Date().toISOString()
    return {
        id: 1,
        nodeServerUrl: null,
        bootstrapPeersEncrypted: null,
        syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
        trustStrictMinAckRatio: DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
        trustStrictMaxAckAgeSeconds: DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
        trustStrictRolloutWaveSize: DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
        trustStrictAutoRollback: DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
        controlEnvelopeTrustRequired: DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
}

export class SystemMeshConfigService extends Context.Service<
    SystemMeshConfigService,
    SystemMeshConfigServiceShape
>()('shared/SystemMeshConfigService') {
    /**
     * Collaborators are constructor arguments: the shape's lifecycle members
     * have an empty requirement channel, and the getters are synchronous.
     */
    static readonly live = class SystemMeshConfigServiceImpl
        implements SystemMeshConfigServiceShape
    {
        private cachedNodeId: string | null = null
        private meshConfig: NodeMeshConfigRow | null = null
        private agentRecord: NodeRecord | null = null
        private readonly nodeConfig: NodeConfigRepositoryShape
        private readonly meshConfigs: NodeMeshConfigRepositoryShape
        private readonly env: {
            readonly appUrl: () => string | undefined
            readonly bootstrapPeers: () => string | undefined
        }
        private readonly agent: {
            readonly read: () => Promise<NodeRecord | null>
            readonly write: (
                patch: Partial<NodeRecordConfig>
            ) => Promise<unknown>
        }

        constructor(options: SystemMeshConfigOptions) {
            this.nodeConfig = options.nodeConfig
            this.meshConfigs = options.meshConfigs
            this.env = options.env
            this.agent = options.agent ?? {
                read: () => readNodeRecord(),
                write: (patch) => writeNodeRecord(patch),
            }
        }

    /** The config loaded at boot; the defaults, unpersisted, for a getter that somehow runs before it. */
    private config(): NodeMeshConfigRow {
        return this.meshConfig ?? defaultRow()
    }

    /** Best-effort: an absent agent leaves the local row as the only copy, which is where today's readers look. */
    private mirrorToAgent(row: NodeMeshConfigRow): Effect.Effect<void> {
        return Effect.tryPromise(() =>
            this.agent.write(meshConfigPatch(row))
        ).pipe(
            Effect.flatMap((taken) =>
                taken === null
                    ? Effect.logDebug(
                          'The node agent did not take the mesh configuration — the local row stays the source'
                      )
                    : Effect.void
            ),
            Effect.catch((err: unknown) =>
                Effect.logWarning(
                    `Failed to mirror the mesh configuration to the node agent: ${err instanceof Error ? err.message : String(err)}`
                )
            )
        )
    }

    /**
     * Resolves the mesh config once, at boot: the stored row when there is one, otherwise the defaults, persisted.
     *
     * Source of truth priority for nodeServerUrl:
     *   1. The mesh section of the node's agent record, when the agent serves one
     *   2. Existing row in NodeMeshConfigRepository (written by setup or admin)
     *   3. APP_URL env var (canonical public URL of this node)
     *   4. null (node will be unreachable from peers until configured)
     *
     * Source of truth priority for bootstrapPeers:
     *   1. The mesh section of the node's agent record
     *   2. Existing row in NodeMeshConfigRepository
     *   3. meshUrlsSnapshot from the node config (setup's snapshot, from the agent's record or the local row)
     *   4. MESH_BOOTSTRAP_PEERS env var (dev/CI override)
     *   5. null
     *
     * If the local `node_mesh_config` table hasn't been migrated yet (the `upsert` returns `null`), the defaults are kept in
     * memory so the rest of the app can still start. The setup wizard is the canonical fix — but refusing to boot the API
     * would prevent the wizard from running.
     */
    private loadMeshConfig(): Effect.Effect<
        NodeMeshConfigRow,
        MeshConfigResolutionFailure
    > {
        return Effect.gen({ self: this }, function* () {
        // The agent owns the node: a mesh config it serves is the node's, not a suggestion the local row may override.
        const agentMesh = this.agentRecord?.config?.mesh
        if (agentMesh) {
            yield* Effect.logInfo(
                'Mesh configuration resolved from the node agent'
            )
            return rowFromAgentMesh(agentMesh)
        }

        const existing = yield* this.meshConfigs.find()
        if (existing) return existing

        // APP_URL is the canonical public URL of this node.
        const appUrl = this.env.appUrl()?.trim()
        const nodeServerUrl = appUrl?.length ? appUrl : null

        // Prefer the setup snapshot on the node config, then fall back to MESH_BOOTSTRAP_PEERS.
        const node = yield* this.nodeConfig.find()
        const snapshotPeers =
            this.agentRecord?.config?.meshUrlsSnapshot ??
            node?.meshUrlsSnapshot ??
            []

        const envBootstrapPeers = this.env.bootstrapPeers()?.trim()
        const bootstrapPeersEncrypted =
            snapshotPeers.length > 0
                ? snapshotPeers.join(',')
                : envBootstrapPeers?.length
                  ? envBootstrapPeers
                  : null

        if (snapshotPeers.length > 0) {
            yield* Effect.logInfo(
                `🔗 Bootstrap peers resolved from setup snapshot: [${snapshotPeers.join(', ')}]`
            )
        } else if (bootstrapPeersEncrypted) {
            yield* Effect.logInfo(
                `🔗 Bootstrap peers resolved from MESH_BOOTSTRAP_PEERS env var`
            )
        } else {
            yield* Effect.logWarning(
                '⚠️  No bootstrap peers configured — this node will start isolated.'
            )
        }

        yield* Effect.logInfo('Initializing local mesh configuration defaults…')

        const now = new Date().toISOString()
        const persisted = yield* this.meshConfigs.upsert({
            nodeServerUrl,
            bootstrapPeersEncrypted,
            syncIntervalMs: DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio: DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds:
                DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize: DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback: DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired:
                DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: now,
            updatedAt: now,
        })

        if (persisted !== null) {
            yield* this.mirrorToAgent(persisted)
            return persisted
        }

        return defaultRow({ nodeServerUrl, bootstrapPeersEncrypted })
        })
    }

    /**
     * Takes the record this node's agent serves and resolves what depends on it.
     * Public so a test can supply a record without a socket; `onModuleInit` is its
     * only production caller.
     */
    applyAgentRecord(
        record: NodeRecord | null
    ): Effect.Effect<void, MeshConfigResolutionFailure> {
        return Effect.gen({ self: this }, function* () {
            this.agentRecord = record
            this.cachedNodeId =
                (yield* this.nodeConfig.find())?.nodeId ?? null
            this.meshConfig = yield* this.loadMeshConfig()
        })
    }

    // The agent owns the node's local database, so it is the first source of the node's identity. Absent (or too
    // old to know the record), the local row stays the source — never the environment.
    onModuleInit(): Effect.Effect<void> {
        return Effect.promise(() => this.agent.read()).pipe(
            Effect.flatMap((record) => this.applyAgentRecord(record)),
            Effect.catch((err) =>
                Effect.logError(
                    `Failed to initialize mesh defaults: ${err instanceof Error ? err.message : String(err)}`
                )
            )
        )
    }

    getNodeId(): string {
        return this.agentRecord?.config?.nodeId ?? this.cachedNodeId ?? ''
    }

    getStreamSharedSecret(): string | null {
        return null
    }

    getNodeServerUrl(): string | null {
        return this.config().nodeServerUrl ?? null
    }

    getControlEnvelopeTrustKeys(): Map<string, MeshConfigTrustKeys> {
        return new Map<string, MeshConfigTrustKeys>()
    }

    getBootstrapPeers(): string | null {
        return this.config().bootstrapPeersEncrypted ?? null
    }

    getSyncIntervalMs(): number {
        return this.config().syncIntervalMs
    }

    getTrustStrictMinAckRatio(): number {
        const ratio = Number(this.config().trustStrictMinAckRatio)
        return Number.isFinite(ratio) ? ratio : 1
    }

    getTrustStrictMaxAckAgeSeconds(): number {
        return this.config().trustStrictMaxAckAgeSeconds
    }

    getTrustStrictRolloutWaveSize(): number {
        return this.config().trustStrictRolloutWaveSize
    }

    getTrustStrictAutoRollback(): boolean {
        return this.config().trustStrictAutoRollback
    }

    getControlEnvelopeTrustRequired(): boolean {
        return this.config().controlEnvelopeTrustRequired
    }
    }

}
