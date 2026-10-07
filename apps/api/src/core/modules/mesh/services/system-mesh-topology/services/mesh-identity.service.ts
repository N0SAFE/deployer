import { Inject, Injectable } from "@nestjs/common";
import { meshNodeStateSchema, type MeshNodeState } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.module";
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
 * IDENTITY IS RESOLVED LAZILY, ON FIRST USE — NOT IN THE CONSTRUCTOR.
 * The constructor used to call `getNodeId()`, which reaches
 * `NodeConfigRepository.upsert()` and therefore the local SQLite file. NestJS
 * instantiates a provider while the graph is being ASSEMBLED, before any
 * `onModuleInit` runs — and local schema migrations run from
 * `LocalDatabaseMigrationService.onModuleInit`. On a fresh database (no
 * `node_config` table yet) the very first construction of this class therefore
 * threw `SQLiteError: no such table: node_config`, taking the whole module graph
 * down with it.
 *
 * Reordering hooks cannot fix that: a constructor doing I/O is an assumption
 * that the database is already shaped, which no constructor is entitled to make.
 * Deferring to first use removes the assumption instead of racing it. The value
 * is cached, so the cost is the same one lookup eager resolution paid, and every
 * caller still sees the same nodeId for the lifetime of the process.
 *
 * NOTE: MeshIdentityService must NOT be used during the setup bootstrap flow —
 * at that point the node has no identity yet. Use MeshSetupService instead.
 */
@Injectable()
export class MeshIdentityService {
    private localNode: MeshNodeState | null = null;
    private hlc: HybridLogicalClock | null = null;

    constructor(
        @Inject(CLOCK_TOKEN) private readonly clock: Clock,
        @Inject(ID_GENERATOR_TOKEN) private readonly idGen: IdGenerator,
        private readonly envService: EnvService,
        private readonly meshConfigService: SystemMeshConfigService,
    ) {}

    /**
     * Resolve the local node's identity on first use.
     *
     * `nodeId` comes from NodeConfigRepository (via SystemMeshConfigService),
     * which the setup wizard populates; it falls back to `MESH_NODE_ID` or a
     * fresh UUID for dev/CI. The HLC is built HERE as well because its
     * construction depends on the nodeId — deriving both in one place is what
     * keeps them from being able to disagree.
     */
    private resolveIdentity(): { localNode: MeshNodeState; hlc: HybridLogicalClock } {
        if (this.localNode !== null && this.hlc !== null) {
            return { localNode: this.localNode, hlc: this.hlc };
        }

        const nowIso = this.clock.nowIso();
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

        return { localNode: this.localNode, hlc: this.hlc };
    }

    // ─── Identity ─────────────────────────────────────────────────────────────

    getLocalNode(): MeshNodeState { return this.resolveIdentity().localNode; }
    getNodeId(): string           { return this.resolveIdentity().localNode.nodeId; }

    // ─── HLC ──────────────────────────────────────────────────────────────────

    tickHlc(): Hlc      { return this.resolveIdentity().hlc.tick(); }
    observeHlc(remote: Hlc): Hlc { return this.resolveIdentity().hlc.observe(remote); }
    snapshotHlc(): Hlc  { return this.resolveIdentity().hlc.snapshot(); }

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