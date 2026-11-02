import { Injectable, type OnModuleInit, Logger, Inject } from '@nestjs/common'

import { runPromiseUnwrapped } from "@deployer/effect-core"
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state"

import { EnvService } from "../../../../config/env/env.module"
import { NodeMeshConfigRepository, type NodeMeshConfigRow } from '../repositories/node-mesh-config.repository'

import { readNodeRecord, writeNodeRecord, type NodeRecord, type NodeRecordConfig } from "./node-record.client"

/** What the agent's record says about this node's mesh: the section `node.configure` writes. */
type AgentMeshConfig = NonNullable<NonNullable<NodeRecord["config"]>["mesh"]>

/** The mesh row as a patch of the agent's record: only the mesh section, nothing of the node config itself. */
const meshConfigPatch = (row: NodeMeshConfigRow): Partial<NodeRecordConfig> => ({
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

@Injectable()
export class SystemMeshConfigService implements OnModuleInit {
    private readonly logger = new Logger(SystemMeshConfigService.name)

    private static readonly DEFAULT_SYNC_INTERVAL_MS = 10_000
    private static readonly DEFAULT_TRUST_STRICT_MIN_ACK_RATIO = '1'
    private static readonly DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS = 300
    private static readonly DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE = 3
    private static readonly DEFAULT_TRUST_STRICT_AUTO_ROLLBACK = false
    private static readonly DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED = false

    private cachedNodeId: string | null = null
    /** The mesh config resolved at boot, so a getter never awaits (or queries) on a request path. */
    private meshConfig: NodeMeshConfigRow | null = null
    /** What this node's own agent says about the node, or null when its agent is absent or predates the record. */
    private agentRecord: NodeRecord | null = null

    constructor(
        private readonly envService: EnvService,
        @Inject(NodeConfigRepository) private readonly nodeConfigRepo: NodeConfigRepositoryShape,
        private readonly nodeMeshConfigRepo: NodeMeshConfigRepository
    ) {}

    async onModuleInit() {
        try {
            // The agent owns the node's local database, so it is the first source of the node's identity. Absent (or
            // too old to know the record), the local row below stays the source — never the environment.
            await this.applyAgentRecord(await readNodeRecord())
        } catch (err: unknown) {
            this.logger.error(
                `Failed to initialize mesh defaults: ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }

    /**
     * Takes the record this node's agent serves and resolves what depends on it. Public so a test can supply a record
     * without a socket; `onModuleInit` is its only production caller.
     */
    async applyAgentRecord(record: NodeRecord | null): Promise<void> {
        this.agentRecord = record
        this.cachedNodeId = (await runPromiseUnwrapped(this.nodeConfigRepo.find()))?.nodeId ?? null
        this.meshConfig = await this.loadMeshConfig()
    }

    // ─── Public getters ───────────────────────────────────────────────────────

    /**
     * This node's platform id, or `""` when the node is not configured yet.
     *
     * Nothing invents one: an unconfigured node has no id, and no environment variable is read here.
     */
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

    // ─── Private initializers ─────────────────────────────────────────────────

    /** The config loaded at boot; the defaults, unpersisted, for a getter that somehow runs before it. */
    private config(): NodeMeshConfigRow {
        return this.meshConfig ?? this.defaults()
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
     * If the local `node_mesh_config` table hasn't been migrated yet (the `upsert` returns `null`), the defaults are
     * kept in memory so the rest of the app can still start. The setup wizard is the canonical fix — but refusing to
     * boot the API would prevent the wizard from running.
     */
    private async loadMeshConfig(): Promise<NodeMeshConfigRow> {
        // The agent owns the node: a mesh config it serves is the node's, not a suggestion the local row may override.
        const agentMesh = this.agentRecord?.config?.mesh
        if (agentMesh) {
            this.logger.log('Mesh configuration resolved from the node agent')
            return this.rowFromAgentMesh(agentMesh)
        }

        const existing = this.nodeMeshConfigRepo.find()
        if (existing) {
            return existing
        }

        // ── nodeServerUrl ────────────────────────────────────────────────────
        // APP_URL is the canonical public URL of this node.
        const appUrl = this.envService.get('APP_URL')?.trim()
        const nodeServerUrl = appUrl?.length ? appUrl : null

        // ── bootstrapPeers ───────────────────────────────────────────────────
        // Prefer the setup snapshot on the node config, then fall back to MESH_BOOTSTRAP_PEERS.
        const nodeConfig = await runPromiseUnwrapped(this.nodeConfigRepo.find())
        const snapshotPeers = this.agentRecord?.config?.meshUrlsSnapshot ?? nodeConfig?.meshUrlsSnapshot ?? []

        const envBootstrapPeers = this.envService.get('MESH_BOOTSTRAP_PEERS')?.trim()
        const bootstrapPeersEncrypted =
            snapshotPeers.length > 0
                ? snapshotPeers.join(',')
                : envBootstrapPeers?.length
                  ? envBootstrapPeers
                  : null

        if (snapshotPeers.length > 0) {
            this.logger.log(
                `🔗 Bootstrap peers resolved from setup snapshot: [${snapshotPeers.join(', ')}]`
            )
        } else if (bootstrapPeersEncrypted) {
            this.logger.log(
                `🔗 Bootstrap peers resolved from MESH_BOOTSTRAP_PEERS env var`
            )
        } else {
            this.logger.warn(
                '⚠️  No bootstrap peers configured — this node will start isolated.'
            )
        }

        this.logger.log('Initializing local mesh configuration defaults…')

        const persisted = this.nodeMeshConfigRepo.upsert({
            nodeServerUrl,
            bootstrapPeersEncrypted,
            syncIntervalMs: SystemMeshConfigService.DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize: SystemMeshConfigService.DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback: SystemMeshConfigService.DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired: SystemMeshConfigService.DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        if (persisted !== null) {
            await this.mirrorToAgent(persisted)
            return persisted
        }

        return this.defaults({ nodeServerUrl, bootstrapPeersEncrypted })
    }

    /** Best-effort: an absent agent leaves the local row as the only copy, which is where today's readers look. */
    private async mirrorToAgent(row: NodeMeshConfigRow): Promise<void> {
        try {
            const taken = await writeNodeRecord(meshConfigPatch(row))
            if (taken === null) {
                this.logger.debug('The node agent did not take the mesh configuration — the local row stays the source')
            }
        } catch (err: unknown) {
            this.logger.warn(
                `Failed to mirror the mesh configuration to the node agent: ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }

    /** The agent's mesh section as the row the rest of the service reads, so no getter has two shapes to handle. */
    private rowFromAgentMesh(mesh: AgentMeshConfig): NodeMeshConfigRow {
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

    private defaults(overrides: Partial<NodeMeshConfigRow> = {}): NodeMeshConfigRow {
        const now = new Date().toISOString()
        return {
            id: 1,
            nodeServerUrl: null,
            bootstrapPeersEncrypted: null,
            syncIntervalMs: SystemMeshConfigService.DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize: SystemMeshConfigService.DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback: SystemMeshConfigService.DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired: SystemMeshConfigService.DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: now,
            updatedAt: now,
            ...overrides,
        }
    }
}
