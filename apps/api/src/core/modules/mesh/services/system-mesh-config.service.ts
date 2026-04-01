import { Injectable, type OnModuleInit, Logger } from "@nestjs/common";
import { EnvService } from "@/config/env/env.service";
import { NodeMeshConfigRepository } from "../repositories/node-mesh-config.repository";
import { NodeConfigRepository } from "@/modules/setup/repositories/node-config.repository";
import { randomUUID } from "node:crypto";

export interface MeshConfigTrustKeys {
    keyId: string;
    algorithm: "HS256" | "HS512";
    secret: string;
    status: "active" | "rotated";
}

@Injectable()
export class SystemMeshConfigService implements OnModuleInit {
    private readonly logger = new Logger(SystemMeshConfigService.name);
    private static readonly DEFAULT_SYNC_INTERVAL_MS = 10_000;
    private static readonly DEFAULT_TRUST_STRICT_MIN_ACK_RATIO = "1";
    private static readonly DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS = 300;
    private static readonly DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE = 3;
    private static readonly DEFAULT_TRUST_STRICT_AUTO_ROLLBACK = false;
    private static readonly DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED = false;

    private cachedNodeId: string | null = null;
    private cachedClusterId: string | null = null;

    constructor(
        private readonly envService: EnvService,
        private readonly nodeConfigRepo: NodeConfigRepository,
        private readonly nodeMeshConfigRepo: NodeMeshConfigRepository,
    ) {}

    onModuleInit() {
        try {
            this.ensureNodeConfig();
            this.ensureMeshConfig();
        } catch (error) {
            this.logger.error(`Failed to initialize mesh defaults: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getNodeId(): string {
        if (this.cachedNodeId) {
            return this.cachedNodeId;
        }

        const config = this.ensureNodeConfig();
        this.cachedNodeId = config.nodeId;
        return config.nodeId;
    }

    getClusterId(): string {
        if (this.cachedClusterId) {
            return this.cachedClusterId;
        }

        const config = this.ensureMeshConfig();
        this.cachedClusterId = config.clusterId;
        return config.clusterId;
    }

    getStreamSharedSecret(): string | null {
        return null;
    }

    getNodeServerUrl(): string | null {
        return this.ensureMeshConfig().nodeServerUrl ?? null;
    }

    getControlEnvelopeTrustKeys(): Map<string, MeshConfigTrustKeys> {
        return new Map<string, MeshConfigTrustKeys>();
    }

    getBootstrapPeers(): string | null {
        return this.ensureMeshConfig().bootstrapPeersEncrypted ?? null;
    }

    getSyncIntervalMs(): number {
        return this.ensureMeshConfig().syncIntervalMs;
    }

    getTrustStrictMinAckRatio(): number {
        const ratio = Number(this.ensureMeshConfig().trustStrictMinAckRatio);
        return Number.isFinite(ratio) ? ratio : 1;
    }

    getTrustStrictMaxAckAgeSeconds(): number {
        return this.ensureMeshConfig().trustStrictMaxAckAgeSeconds;
    }

    getTrustStrictRolloutWaveSize(): number {
        return this.ensureMeshConfig().trustStrictRolloutWaveSize;
    }

    getTrustStrictAutoRollback(): boolean {
        return this.ensureMeshConfig().trustStrictAutoRollback;
    }

    getControlEnvelopeTrustRequired(): boolean {
        return this.ensureMeshConfig().controlEnvelopeTrustRequired;
    }

    private ensureNodeConfig() {
        const existing = this.nodeConfigRepo.find();
        if (existing?.nodeId) {
            return existing;
        }

        const now = new Date().toISOString();
        const envNodeIdRaw = this.envService.get("MESH_NODE_ID");
        const envNodeId = envNodeIdRaw?.trim() ?? randomUUID();

        this.logger.log("Initializing local node configuration defaults...");
        return this.nodeConfigRepo.upsert({
            databaseUrl: existing?.databaseUrl ?? null,
            nodeId: envNodeId,
            configuredAt: existing?.configuredAt ?? now,
            updatedAt: now,
        });
    }

    private ensureMeshConfig() {
        const existing = this.nodeMeshConfigRepo.find();
        if (existing?.clusterId) {
            return existing;
        }

        const now = new Date().toISOString();
        const envClusterIdRaw = this.envService.get("MESH_CLUSTER_ID");
        const envNodeServerUrlRaw = this.envService.get("MESH_NODE_SERVER_URL");
        const envBootstrapPeersRaw = this.envService.get("MESH_BOOTSTRAP_PEERS");

        const envClusterId = typeof envClusterIdRaw === "string" ? envClusterIdRaw.trim() : "";
        const envNodeServerUrl = typeof envNodeServerUrlRaw === "string" ? envNodeServerUrlRaw.trim() : "";
        const envBootstrapPeers = typeof envBootstrapPeersRaw === "string" ? envBootstrapPeersRaw.trim() : "";

        this.logger.log("Initializing local mesh configuration defaults...");
        return this.nodeMeshConfigRepo.upsert({
            clusterId: envClusterId || randomUUID(),
            nodeServerUrl: envNodeServerUrl || null,
            bootstrapPeersEncrypted: envBootstrapPeers || null,
            syncIntervalMs: SystemMeshConfigService.DEFAULT_SYNC_INTERVAL_MS,
            trustStrictMinAckRatio: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MIN_ACK_RATIO,
            trustStrictMaxAckAgeSeconds: SystemMeshConfigService.DEFAULT_TRUST_STRICT_MAX_ACK_AGE_SECONDS,
            trustStrictRolloutWaveSize: SystemMeshConfigService.DEFAULT_TRUST_STRICT_ROLLOUT_WAVE_SIZE,
            trustStrictAutoRollback: SystemMeshConfigService.DEFAULT_TRUST_STRICT_AUTO_ROLLBACK,
            controlEnvelopeTrustRequired: SystemMeshConfigService.DEFAULT_CONTROL_ENVELOPE_TRUST_REQUIRED,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        });
    }
}
