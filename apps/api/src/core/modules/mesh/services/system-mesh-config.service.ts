import { Injectable, type OnModuleInit, Logger } from '@nestjs/common'
import { EnvService } from '@/config/env/env.service'
import { NodeMeshConfigRepository, type NodeMeshConfigRow } from '../repositories/node-mesh-config.repository'
import { NodeConfigRepository } from '@/core/modules/setup/repositories/node-config.repository'
import { randomUUID } from 'node:crypto'

export interface MeshConfigTrustKeys {
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

    constructor(
        private readonly envService: EnvService,
        private readonly nodeConfigRepo: NodeConfigRepository,
        private readonly nodeMeshConfigRepo: NodeMeshConfigRepository
    ) {}

    onModuleInit() {
        try {
            this.ensureNodeConfig()
            this.ensureMeshConfig()
        } catch (err: unknown) {
            this.logger.error(
                `Failed to initialize mesh defaults: ${err instanceof Error ? err.message : String(err)}`
            )
        }
    }

    // ─── Public getters ───────────────────────────────────────────────────────

    getNodeId(): string {
        if (this.cachedNodeId) {
            return this.cachedNodeId
        }
        const config = this.ensureNodeConfig()
        this.cachedNodeId = config.nodeId
        return config.nodeId
    }

    getStreamSharedSecret(): string | null {
        return null
    }

    getNodeServerUrl(): string | null {
        return this.ensureMeshConfig().nodeServerUrl ?? null
    }

    getControlEnvelopeTrustKeys(): Map<string, MeshConfigTrustKeys> {
        return new Map<string, MeshConfigTrustKeys>()
    }

    getBootstrapPeers(): string | null {
        return this.ensureMeshConfig().bootstrapPeersEncrypted ?? null
    }

    getSyncIntervalMs(): number {
        return this.ensureMeshConfig().syncIntervalMs
    }

    getTrustStrictMinAckRatio(): number {
        const ratio = Number(this.ensureMeshConfig().trustStrictMinAckRatio)
        return Number.isFinite(ratio) ? ratio : 1
    }

    getTrustStrictMaxAckAgeSeconds(): number {
        return this.ensureMeshConfig().trustStrictMaxAckAgeSeconds
    }

    getTrustStrictRolloutWaveSize(): number {
        return this.ensureMeshConfig().trustStrictRolloutWaveSize
    }

    getTrustStrictAutoRollback(): boolean {
        return this.ensureMeshConfig().trustStrictAutoRollback
    }

    getControlEnvelopeTrustRequired(): boolean {
        return this.ensureMeshConfig().controlEnvelopeTrustRequired
    }

    // ─── Private initializers ─────────────────────────────────────────────────

    /**
     * Ensures a node config row exists in SQLite.
     *
     * Source of truth priority:
     *   1. Existing row in NodeConfigRepository (written by setup wizard)
     *   2. MESH_NODE_ID env var (dev/CI override)
     *   3. Random UUID (first-boot fallback — will be overwritten by setup)
     *
     * NOTE: if the setup wizard has already run, this is a no-op (row exists).
     * We never overwrite a nodeId that was assigned by the setup.
     */
    private ensureNodeConfig() {
        const existing = this.nodeConfigRepo.find()
        if (existing?.nodeId) {
            return existing
        }

        // No setup has run yet — bootstrap a minimal placeholder so the mesh
        // can start in degraded mode. Setup wizard will overwrite this.
        const now = new Date().toISOString()

        // Prefer env var for dev/CI, fall back to random UUID
        const envNodeId = this.envService.get('MESH_NODE_ID')?.trim()
        const nodeId = envNodeId?.length ? envNodeId : randomUUID()

        this.logger.warn(
            '⚠️  No setup config found — creating placeholder node config. ' +
                'Run the setup wizard to finalize this node.'
        )

        return this.nodeConfigRepo.upsert({
            nodeId,
            strategy: 'local',
            meshUrlsSnapshot: [],
            configuredAt: null,
            updatedAt: now,
        })
    }

    /**
     * Ensures a mesh config row exists in NodeMeshConfigRepository.
     *
     * Source of truth priority for nodeServerUrl:
     *   1. Existing row in NodeMeshConfigRepository (written by setup or admin)
     *   2. APP_URL env var (canonical public URL of this node)
     *   3. null (node will be unreachable from peers until configured)
     *
     * Source of truth priority for bootstrapPeers:
     *   1. Existing row in NodeMeshConfigRepository
     *   2. meshUrlsSnapshot from NodeConfigRepository ← set by setup wizard
     *   3. MESH_BOOTSTRAP_PEERS env var (dev/CI override)
     *   4. null
     *
     * If the local `node_mesh_config` table hasn't been migrated yet
     * (the `upsert` returns `null`), we fall back to an in-memory
     * config so the rest of the app can still start. The setup wizard
     * is the canonical fix for this — but refusing to boot the API
     * would prevent the wizard from running.
     */
    private ensureMeshConfig() {
        const existing = this.nodeMeshConfigRepo.find()
        if (existing) {
            return existing
        }

        const now = new Date().toISOString()

        // ── nodeServerUrl ────────────────────────────────────────────────────
        // APP_URL is the canonical public URL of this node.
        const appUrl = this.envService.get('APP_URL')?.trim()
        const nodeServerUrl = appUrl?.length ? appUrl : null

        // ── bootstrapPeers ───────────────────────────────────────────────────
        // Prefer meshUrlsSnapshot from NodeConfigRepository (set by setup wizard),
        // then fall back to MESH_BOOTSTRAP_PEERS env var
        const nodeConfig = this.nodeConfigRepo.find()
        const snapshotPeers = nodeConfig?.meshUrlsSnapshot ?? []

        const envBootstrapPeers = this.envService
            .get('MESH_BOOTSTRAP_PEERS')
            ?.trim()
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

        // Build the in-memory defaults *first* so we can return them
        // even if the persist attempt fails (e.g. table missing).
        const fallbackRow: NodeMeshConfigRow = {
            id: 1,
            nodeServerUrl,
            bootstrapPeersEncrypted,
            syncIntervalMs: SystemMeshConfigService.DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired:
                SystemMeshConfigService.DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: now,
            updatedAt: now,
        }

        const persisted = this.nodeMeshConfigRepo.upsert({
            nodeServerUrl,
            bootstrapPeersEncrypted,
            syncIntervalMs: SystemMeshConfigService.DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback:
                SystemMeshConfigService.DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired:
                SystemMeshConfigService.DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: now,
            updatedAt: now,
        });

        return persisted ?? fallbackRow;
    }
}
