import { Injectable } from "@nestjs/common";
import type { MeshPeerConnection, MeshPeerLinkMetrics, MeshResourceLocation } from "@repo/contracts-entities";

export interface MeshLogicConfig {
    reconnectBaseDelayMs: number;
    reconnectMaxDelayMs: number;
    reconnectMultiplier: number;
    reconnectJitterRatio: number;
}

@Injectable()
export class SystemMeshLogicService {
    private readonly config: MeshLogicConfig;

    constructor() {
        this.config = {
            reconnectBaseDelayMs: 500,
            reconnectMaxDelayMs: 30_000,
            reconnectMultiplier: 2,
            reconnectJitterRatio: 0.2,
        };
    }

    getConfig(): MeshLogicConfig {
        return this.config;
    }

    computeNextReconnectAt(attempt: number, nowMs: number): string {
        const exponentialBase =
            this.config.reconnectBaseDelayMs * Math.pow(this.config.reconnectMultiplier, Math.max(0, attempt - 1));
        const bounded = Math.min(this.config.reconnectMaxDelayMs, exponentialBase);
        const jitterFactor = 1 + (Math.random() * 2 - 1) * this.config.reconnectJitterRatio;
        const delayMs = Math.max(0, Math.round(bounded * jitterFactor));
        return new Date(nowMs + delayMs).toISOString();
    }

    computeWeightedMetrics(metrics: MeshPeerLinkMetrics): MeshPeerLinkMetrics {
        const latencyNorm = this.normalize(metrics.latencyMs, 500);
        const jitterNorm = this.normalize(metrics.jitterMs, 200);
        const packetLossNorm = this.normalize(metrics.packetLossRatio, 1);
        const throughputNorm = this.normalize(metrics.throughputMbps, 1_000);
        const reliabilityPenalty = 1 - this.normalize(metrics.reliabilityScore, 1);

        const weight =
            0.45 * latencyNorm +
            0.2 * jitterNorm +
            0.2 * packetLossNorm +
            0.1 * (1 - throughputNorm) +
            0.05 * reliabilityPenalty;

        return {
            ...metrics,
            weight: Number(weight.toFixed(6)),
            measuredAt: new Date().toISOString(),
        };
    }

    recomputePathRanks(connections: Iterable<MeshPeerConnection>): MeshPeerConnection[] {
        const ranked = [...connections].sort((left, right) => left.metrics.weight - right.metrics.weight);
        return ranked.map((connection, index) => ({
            ...connection,
            activePathRank: index + 1,
        }));
    }

    rankResourceLocations(resources: MeshResourceLocation[]): MeshResourceLocation[] {
        return [...resources].sort((left, right) => {
            if (left.priority !== right.priority) {
                return left.priority - right.priority;
            }

            if (left.updatedAt !== right.updatedAt) {
                return right.updatedAt.localeCompare(left.updatedAt);
            }

            if (left.version !== right.version) {
                return right.version - left.version;
            }

            return left.ownerNodeId.localeCompare(right.ownerNodeId);
        });
    }

    private normalize(value: number, max: number): number {
        if (max <= 0) {
            return 0;
        }

        return Math.min(1, Math.max(0, value / max));
    }
}