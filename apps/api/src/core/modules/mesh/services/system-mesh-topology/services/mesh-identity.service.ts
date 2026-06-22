import { Inject, Injectable } from "@nestjs/common";
import { meshNodeStateSchema, type MeshNodeState } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.service";
import { CLOCK_TOKEN, type Clock } from "../../../shared/primitives/clock";
import { ID_GENERATOR_TOKEN, type IdGenerator } from "../../../shared/primitives/id-generator";
import { HybridLogicalClock, type Hlc } from "../../../shared/primitives/hybrid-logical-clock";
import { SystemMeshConfigService } from "../../system-mesh-config.service";

/**
 * Source of truth for the local node's identity and HLC.
 *
 * The nodeId is resolved from SystemMeshConfigService which reads
 * NodeConfigRepository (written by the setup wizard) as its primary source.
 * Env vars are only a fallback for dev/CI environments.
 *
 * NOTE: MeshIdentityService must NOT be used during the setup bootstrap flow —
 * at that point the node has no identity yet. Use MeshSetupService instead.
 */
@Injectable()
export class MeshIdentityService {
    private readonly localNode: MeshNodeState;
    private readonly hlc: HybridLogicalClock;

    constructor(
        @Inject(CLOCK_TOKEN) private readonly clock: Clock,
        @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
        private readonly envService: EnvService,
        private readonly meshConfigService: SystemMeshConfigService,
    ) {
        const nowIso = this.clock.nowIso();

        // nodeId comes from NodeConfigRepository (via SystemMeshConfigService)
        // which is populated by the setup wizard.
        // Falls back to MESH_NODE_ID env var or a fresh UUID for dev/CI.
        const nodeId = this.meshConfigService.getNodeId();

        this.localNode = meshNodeStateSchema.parse({
            nodeId,
            region:           "auto",
            roles:            ["edge"],
            lifecycleState:   "healthy",
            routingMode:      "balanced",
            consistencyMode:  "hybrid",
            version:          "v3-mesh-alpha",
            startedAt:        nowIso,
            lastSeenAt:       nowIso,
            metadata:         null,
        });

        this.hlc = new HybridLogicalClock(nodeId, this.clock);
    }

    // ─── Identity ─────────────────────────────────────────────────────────────

    getLocalNode(): MeshNodeState { return this.localNode; }
    getNodeId(): string           { return this.localNode.nodeId; }

    // ─── HLC ──────────────────────────────────────────────────────────────────

    tickHlc(): Hlc      { return this.hlc.tick(); }
    observeHlc(remote: Hlc): Hlc { return this.hlc.observe(remote); }
    snapshotHlc(): Hlc  { return this.hlc.snapshot(); }

    // ─── Server URL ───────────────────────────────────────────────────────────

    /**
     * Resolves the public URL of this node.
     *
     * Priority:
     *   1. NodeMeshConfigRepository.nodeServerUrl (set by setup or admin)
     *   2. APP_URL env var
     *   3. http://127.0.0.1:{API_PORT}
     */
    resolveLocalServerUrl(): string {
        const configured = this.meshConfigService.getNodeServerUrl();
        if (configured?.trim()) return configured.trim();

        const appUrl = this.envService.get("APP_URL")?.toString().trim();
        if (appUrl) {
            try { return new URL(appUrl).origin; } catch { return appUrl; }
        }

        const port = this.envService.get("API_PORT");
        return `http://127.0.0.1:${String(port)}`;
    }
}