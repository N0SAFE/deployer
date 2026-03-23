import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { EnvService } from "../../../config/env/env.service";
import { signMeshToken } from "@repo/auth/mesh";
import type {
    MeshLoadReport,
    ReportedResource,
    RouteCandidate,
    RouteHintPayload,
    RouteResolution,
} from "../types/load-balancer.types";

const SCORE_EPSILON = 1e-9;

interface NodeSnapshot {
    nodeId: string;
    serverUrl: string;
    organizationId: string;
    healthy: boolean;
    lastSeenAt: number;
    metrics: MeshLoadReport["metrics"];
};

interface IngestLoadReportResult {
    accepted: boolean;
    reportId: string;
    propagated: boolean;
    deduplicated: boolean;
    hopCount: number;
};

interface LoadReportConvergenceNode {
    nodeId: string;
    serverUrl: string;
    lastSeenAt: string;
    fresh: boolean;
    healthy: boolean;
};

interface LoadReportConvergenceSnapshot {
    reportTtlMs: number;
    generatedAt: string;
    organizations: {
        organizationId: string;
        observedNodeCount: number;
        freshNodeCount: number;
        staleNodeCount: number;
        lastReportedAt: string | null;
        nodes: LoadReportConvergenceNode[];
    }[];
};

interface MeshTrustKeyringSecretsSnapshot {
    activeKeyId: string | null;
    keys: {
        keyId: string;
        algorithm: "HS256";
        status: "active" | "previous";
        secretMaterial: string;
    }[];
}

@Injectable()
export class LoadBalancerService {
    constructor(private readonly envService: EnvService = new EnvService()) {}

    private readonly nodes = new Map<string, NodeSnapshot>();
    private readonly resourceIndex = new Map<string, Map<string, ReportedResource>>();
    private readonly seenReportIds = new Map<string, number>();
    private cachedRouteSecrets: { active: string; verify: string[]; loadedAt: number } | null = null;
    private routeSecretsRefreshInFlight: Promise<void> | null = null;

    private get routeSecretRefreshMs(): number {
        const value = this.envService.get("LB_ROUTE_KEYRING_REFRESH_MS") as number | string | undefined;
        const parsed = typeof value === "number" ? value : Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
    }

    private get apiBaseUrl(): string {
        const apiUrl = (this.envService.get("API_URL") as string | undefined)?.trim();
        return apiUrl || "http://localhost:3005";
    }

    private envRouteSecrets(): { active: string; verify: string[] } {
        const canonicalActive = (this.envService.get("LB_FORWARD_TOKEN_SECRET"))?.trim();
        const legacyActive = (this.envService.get("LB_ROUTE_SECRET") as string | undefined)?.trim();
        const active = canonicalActive || legacyActive || "dev-lb-route-secret";

        const canonicalPreviousRaw =
            (this.envService.get("LB_FORWARD_TOKEN_SECRET_PREVIOUS") as string | undefined) ?? "";
        const legacyPreviousRaw = (this.envService.get("LB_ROUTE_SECRET_PREVIOUS") as string | undefined) ?? "";
        const previousRaw = [canonicalPreviousRaw, legacyPreviousRaw].filter(Boolean).join(",");

        const previous = previousRaw
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);

        const verify = [active, ...previous.filter((secret) => secret !== active)];
        return { active, verify };
    }

    private get routeSecrets(): { active: string; verify: string[] } {
        if (this.cachedRouteSecrets) {
            return {
                active: this.cachedRouteSecrets.active,
                verify: [...this.cachedRouteSecrets.verify],
            };
        }

        return this.envRouteSecrets();
    }

    async refreshRouteSecretsFromControlPlane(force = false): Promise<void> {
        if (this.routeSecretsRefreshInFlight) {
            await this.routeSecretsRefreshInFlight;
            return;
        }

        const now = Date.now();
        if (!force && this.cachedRouteSecrets && now - this.cachedRouteSecrets.loadedAt < this.routeSecretRefreshMs) {
            return;
        }

        this.routeSecretsRefreshInFlight = (async () => {
            try {
                const endpoint = new URL("/core/mesh/trust/keyring/secrets", this.apiBaseUrl).toString();
                const headers = new globalThis.Headers({
                    accept: "application/json",
                });

                const meshInternalKey = this.envService.get("MESH_STREAM_SHARED_SECRET")?.trim();
                if (meshInternalKey) {
                    headers.set("x-mesh-internal-key", signMeshToken(meshInternalKey));
                }

                const response = await fetch(endpoint, {
                    method: "GET",
                    headers,
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch keyring secrets (${response.status})`);
                }

                const payload = (await response.json()) as MeshTrustKeyringSecretsSnapshot;
                const keys = Array.isArray(payload?.keys) ? payload.keys : [];
                const usableKeys = keys.filter(
                    (key) =>
                        (key.status === "active" || key.status === "previous") &&
                        typeof key.secretMaterial === "string" &&
                        key.secretMaterial.trim().length > 0,
                );

                if (usableKeys.length === 0) {
                    throw new Error("No usable trust keys available from control plane");
                }

                const activeFromPayload =
                    typeof payload.activeKeyId === "string" && payload.activeKeyId.length > 0
                        ? usableKeys.find((key) => key.keyId === payload.activeKeyId)
                        : null;
                const active = activeFromPayload ?? usableKeys.find((key) => key.status === "active") ?? usableKeys[0];
                if (!active) {
                    throw new Error("No active trust key resolved from control plane payload");
                }

                const verify = [
                    active.secretMaterial,
                    ...usableKeys
                        .filter((key) => key.keyId !== active.keyId)
                        .map((key) => key.secretMaterial)
                        .filter((secret, index, list) => list.indexOf(secret) === index),
                ];

                this.cachedRouteSecrets = {
                    active: active.secretMaterial,
                    verify,
                    loadedAt: Date.now(),
                };
            } catch {
                if (!this.cachedRouteSecrets) {
                    const fallback = this.envRouteSecrets();
                    this.cachedRouteSecrets = {
                        active: fallback.active,
                        verify: fallback.verify,
                        loadedAt: Date.now(),
                    };
                }
            }
        })();

        try {
            await this.routeSecretsRefreshInFlight;
        } finally {
            this.routeSecretsRefreshInFlight = null;
        }
    }

    private get reportTtlMs(): number {
        const value = this.envService.get("LB_REPORT_TTL_MS") as number | string | undefined;
        const parsed = typeof value === "number" ? value : Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 30_000;
    }

    private get reportDedupeTtlMs(): number {
        const value = this.envService.get("LB_LOAD_REPORT_DEDUPE_TTL_MS") as number | string | undefined;
        const parsed = typeof value === "number" ? value : Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
    }

    private get maxGossipHops(): number {
        const value = this.envService.get("LB_LOAD_REPORT_MAX_HOPS") as number | string | undefined;
        const parsed = typeof value === "number" ? value : Number(value);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
    }

    private get localNodeId(): string {
        const nodeId = this.envService.get("MESH_NODE_ID");
        return nodeId?.trim() ?? `lb-${String(process.pid)}`;
    }

    private get peerUrls(): string[] {
        const raw = (this.envService.get("LB_PEER_URLS") as string | undefined) ?? "";
        if (!raw.trim()) {
            return [];
        }

        return raw
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
    }

    ingestLoadReport(report: MeshLoadReport): IngestLoadReportResult {
        this.cleanupSeenReports();

        const now = Date.now();
        const reportId = report.reportId?.trim() ?? randomUUID();
        const hopCount = Number.isFinite(report.hopCount) ? Math.max(0, Number(report.hopCount)) : 0;

        if (this.seenReportIds.has(reportId)) {
            return {
                accepted: true,
                reportId,
                propagated: false,
                deduplicated: true,
                hopCount,
            };
        }

        this.seenReportIds.set(reportId, now);

        const reportedAt = report.reportedAt ? Date.parse(report.reportedAt) : now;
        const normalizedReportedAt = Number.isFinite(reportedAt) ? reportedAt : now;

        this.nodes.set(this.toNodeSnapshotKey(report.organizationId, report.nodeId), {
            nodeId: report.nodeId,
            serverUrl: report.serverUrl,
            organizationId: report.organizationId,
            healthy: report.healthy ?? true,
            lastSeenAt: normalizedReportedAt,
            metrics: report.metrics,
        });

        const resources = report.resources ?? [];
        for (const resource of resources) {
            const key = this.toResourceIndexKey(report.organizationId, resource.streamKey);
            if (!this.resourceIndex.has(key)) {
                this.resourceIndex.set(key, new Map());
            }

            const perResource = this.resourceIndex.get(key);
            if (!perResource) {
                continue;
            }

            perResource.set(report.nodeId, resource);
        }

        const shouldPropagate = hopCount < this.maxGossipHops && this.peerUrls.length > 0;
        if (shouldPropagate) {
            const payload: MeshLoadReport = {
                ...report,
                reportId,
                originNodeId: report.originNodeId ?? report.nodeId,
                forwardedByNodeId: this.localNodeId,
                hopCount: hopCount + 1,
                reportedAt: new Date(normalizedReportedAt).toISOString(),
            };

            void this.propagateLoadReport(payload);
        }

        return {
            accepted: true,
            reportId,
            propagated: shouldPropagate,
            deduplicated: false,
            hopCount,
        };
    }

    getLoadReportConvergence(organizationId?: string): LoadReportConvergenceSnapshot {
        const now = Date.now();
        const grouped = new Map<string, NodeSnapshot[]>();

        for (const node of this.nodes.values()) {
            if (organizationId && node.organizationId !== organizationId) {
                continue;
            }

            const list = grouped.get(node.organizationId) ?? [];
            list.push(node);
            grouped.set(node.organizationId, list);
        }

        const organizations = [...grouped.entries()]
            .map(([orgId, nodes]) => {
                const sorted = nodes
                    .slice()
                    .sort((a, b) => b.lastSeenAt - a.lastSeenAt || a.nodeId.localeCompare(b.nodeId));

                const items: LoadReportConvergenceNode[] = sorted.map((node) => ({
                    nodeId: node.nodeId,
                    serverUrl: node.serverUrl,
                    lastSeenAt: new Date(node.lastSeenAt).toISOString(),
                    fresh: now - node.lastSeenAt <= this.reportTtlMs,
                    healthy: node.healthy,
                }));

                const freshNodeCount = items.filter((item) => item.fresh).length;
                return {
                    organizationId: orgId,
                    observedNodeCount: items.length,
                    freshNodeCount,
                    staleNodeCount: items.length - freshNodeCount,
                    lastReportedAt: items[0]?.lastSeenAt ?? null,
                    nodes: items,
                };
            })
            .sort((a, b) => a.organizationId.localeCompare(b.organizationId));

        return {
            reportTtlMs: this.reportTtlMs,
            generatedAt: new Date(now).toISOString(),
            organizations,
        };
    }

    resolveRoute(input: {
        organizationId: string;
        streamKey: string;
        hintToken?: string | null;
    }): RouteResolution {
        const now = Date.now();
        const healthyNodes = [...this.nodes.values()].filter(
            (node) =>
                node.organizationId === input.organizationId &&
                node.healthy &&
                now - node.lastSeenAt <= this.reportTtlMs,
        );

        if (healthyNodes.length === 0) {
            return {
                selected: null,
                candidates: [],
                routeHintToken: null,
                fallbackUsed: false,
            };
        }

        const owners = this.resourceIndex.get(
            this.toResourceIndexKey(input.organizationId, input.streamKey),
        );
        const candidates: RouteCandidate[] = healthyNodes
            .map((node) => {
                const resourceMeta = owners?.get(node.nodeId);
                return {
                    nodeId: node.nodeId,
                    serverUrl: node.serverUrl,
                    healthy: true,
                    score: this.computeScore(node, resourceMeta),
                    reason: resourceMeta?.isOwner
                        ? "owner+load"
                        : owners?.size
                          ? "owner-set+load"
                          : "load-only",
                };
            })
                        .sort((left, right) => this.compareCandidatesForParity(left, right));

        const hint = this.verifyRouteHint(input.hintToken);
        const hinted =
            hint?.orgId === input.organizationId && hint.streamKey === input.streamKey
                ? candidates.find((candidate) => candidate.nodeId === hint.preferredNodeId) ?? null
                : null;

        const selected = hinted ?? candidates[0] ?? null;
        const fallbackUsed = hinted === null && hint !== null;

        const routeHintToken =
            selected === null
                ? null
                : this.signRouteHint({
                      v: 1,
                      orgId: input.organizationId,
                      streamKey: input.streamKey,
                      preferredNodeId: selected.nodeId,
                      candidateNodeIds: candidates.map((candidate) => candidate.nodeId),
                      iat: Math.floor(now / 1000),
                      exp: Math.floor(now / 1000) + 60,
                  });

        return {
            selected,
            candidates,
            routeHintToken,
            fallbackUsed,
        };
    }

    buildRedirectUrl(input: {
        serverUrl: string;
        targetPath: string;
        replay?: string;
        replayLimit?: string;
    }): string {
        const url = new URL(input.targetPath, input.serverUrl);

        if (input.replay !== undefined) {
            url.searchParams.set("replay", input.replay);
        }
        if (input.replayLimit !== undefined) {
            url.searchParams.set("replayLimit", input.replayLimit);
        }

        return url.toString();
    }

    verifyRouteHint(token: string | null | undefined): RouteHintPayload | null {
        if (!token) {
            return null;
        }

        const [version, payloadB64, signature] = token.split(".");
        if (version !== "v1" || !payloadB64 || !signature) {
            return null;
        }

        const unsigned = `${version}.${payloadB64}`;
        const validSignature = this.routeSecrets.verify.some((secret) =>
            this.safeEqual(signature, this.signWithSecret(unsigned, secret)),
        );
        if (!validSignature) {
            return null;
        }

        try {
            const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
            const payload = JSON.parse(payloadJson) as RouteHintPayload;

            const now = Math.floor(Date.now() / 1000);
            if (payload.exp <= now) {
                return null;
            }

            return payload;
        } catch {
            return null;
        }
    }

    private signRouteHint(payload: RouteHintPayload): string {
        const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
        const unsigned = `v1.${payloadB64}`;
        return `${unsigned}.${this.sign(unsigned)}`;
    }

    private sign(value: string): string {
        return this.signWithSecret(value, this.routeSecrets.active);
    }

    private signWithSecret(value: string, secret: string): string {
        return createHmac("sha256", secret).update(value).digest("base64url");
    }

    private safeEqual(left: string, right: string): boolean {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return timingSafeEqual(leftBuffer, rightBuffer);
    }

    private toResourceIndexKey(organizationId: string, streamKey: string): string {
        return `${organizationId}::${streamKey}`;
    }

    private toNodeSnapshotKey(organizationId: string, nodeId: string): string {
        return `${organizationId}::${nodeId}`;
    }

    private cleanupSeenReports(): void {
        const now = Date.now();
        for (const [reportId, seenAt] of this.seenReportIds.entries()) {
            if (now - seenAt > this.reportDedupeTtlMs) {
                this.seenReportIds.delete(reportId);
            }
        }
    }

    private async propagateLoadReport(report: MeshLoadReport): Promise<void> {
        const meshInternalKey = this.envService.get("MESH_STREAM_SHARED_SECRET")?.trim();

        await Promise.allSettled(
            this.peerUrls.map(async (peerUrl) => {
                const url = new URL("/internal/mesh/load-report", peerUrl).toString();
                const headers = new globalThis.Headers({
                    "content-type": "application/json",
                });

                if (meshInternalKey) {
                    headers.set("x-mesh-internal-key", signMeshToken(meshInternalKey));
                }

                await fetch(url, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(report),
                });
            }),
        );
    }

    private clamp01(value: number): number {
        if (Number.isNaN(value)) {
            return 0;
        }
        if (value <= 0) {
            return 0;
        }
        if (value >= 1) {
            return 1;
        }
        return value;
    }

    private computeScore(node: NodeSnapshot, resourceMeta?: ReportedResource): number {
        const cpu = this.clamp01(node.metrics.cpuUsage);
        const memory = this.clamp01(node.metrics.memoryUsage);
        const errorRate = this.clamp01(node.metrics.errorRate ?? 0);

        const streamPressure = this.clamp01(node.metrics.activeStreams / 1000);
        const queuePressure = this.clamp01(node.metrics.queueDepth / 1000);

        const ownerBonus = resourceMeta?.isOwner ? 0.2 : 0;
        const explicitPriorityBonus = ((resourceMeta?.priority ?? 0) / 1000) * 0.15;

        const rawScore = (
            0.4 * (1 - cpu) +
            0.2 * (1 - memory) +
            0.15 * (1 - streamPressure) +
            0.15 * (1 - queuePressure) +
            0.1 * (1 - errorRate) +
            ownerBonus +
            explicitPriorityBonus
        );

        return Number(rawScore.toFixed(12));
    }

    private compareCandidatesForParity(left: RouteCandidate, right: RouteCandidate): number {
        const scoreDelta = right.score - left.score;
        if (Math.abs(scoreDelta) > SCORE_EPSILON) {
            return scoreDelta > 0 ? 1 : -1;
        }

        const nodeCompare = left.nodeId.localeCompare(right.nodeId);
        if (nodeCompare !== 0) {
            return nodeCompare;
        }

        return left.serverUrl.localeCompare(right.serverUrl);
    }
}