import { Injectable } from "@nestjs/common";
import type { DependencyTemplateConfig } from "@repo/api-contracts/common/template";
import type { ServiceDag } from "./service-dag.service";

export type RolloutMode = DependencyTemplateConfig["rolloutMode"];

export interface CanaryConfig {
    /** Percentage of traffic to route to the canary instance (1–99) */
    canaryWeight: number;
    /** Number of minutes to wait before promoting to 100% */
    promotionWindowMinutes: number;
}

export interface RollingConfig {
    /** Max number of services to update simultaneously */
    maxConcurrent: number;
    /** Minimum ms to wait between waves */
    wavePauseMs: number;
}

/**
 * A rollout wave is a group of services that should be deployed together.
 * All services in a wave start at the same time; the next wave starts only
 * after all services in the current wave pass their readiness gate.
 */
export interface RolloutWave {
    index: number;
    serviceIds: string[];
    mode: RolloutMode;
    /** Wave-specific config controlled by rolling/canary policy */
    rollingConfig?: RollingConfig;
    canaryConfig?: CanaryConfig;
}

export interface RolloutPlan {
    waves: RolloutWave[];
    mode: RolloutMode;
    totalServices: number;
}

/**
 * T039 — Fleet rollout strategies.
 *
 * Converts a ServiceDag into a sequenced RolloutPlan according to the rollout mode
 * configured in DependencyTemplateConfig:
 *
 * - `ordered`   → one wave per DAG layer; each layer waits for the previous
 * - `parallel`  → single wave containing all services (deploy all at once)
 * - `rolling`   → DAG layers respected but max-concurrent per wave is bounded
 * - `canary`    → first service in the first layer gets canary; rest are promoted after window
 */
@Injectable()
export class FleetRolloutPlannerService {
    plan(
        dag: ServiceDag,
        config: Pick<DependencyTemplateConfig, "rolloutMode" | "retryPolicy">,
        options?: { rolling?: RollingConfig; canary?: CanaryConfig },
    ): RolloutPlan {
        switch (config.rolloutMode) {
            case "parallel":
                return this.buildParallelPlan(dag);
            case "rolling":
                return this.buildRollingPlan(dag, options?.rolling ?? { maxConcurrent: 2, wavePauseMs: 5000 });
            case "canary":
                return this.buildCanaryPlan(dag, options?.canary ?? { canaryWeight: 10, promotionWindowMinutes: 30 });
            case "ordered":
            default:
                return this.buildOrderedPlan(dag);
        }
    }

    private buildOrderedPlan(dag: ServiceDag): RolloutPlan {
        const waves: RolloutWave[] = dag.layers.map((layer, i) => ({
            index: i,
            serviceIds: layer,
            mode: "ordered",
        }));
        return { waves, mode: "ordered", totalServices: dag.nodes.size };
    }

    private buildParallelPlan(dag: ServiceDag): RolloutPlan {
        const all = [...dag.nodes.keys()].sort();
        return {
            waves: [{ index: 0, serviceIds: all, mode: "parallel" }],
            mode: "parallel",
            totalServices: dag.nodes.size,
        };
    }

    private buildRollingPlan(dag: ServiceDag, rolling: RollingConfig): RolloutPlan {
        const waves: RolloutWave[] = [];
        let waveIndex = 0;

        for (const layer of dag.layers) {
            // Chunk the layer into groups of maxConcurrent
            for (let i = 0; i < layer.length; i += rolling.maxConcurrent) {
                waves.push({
                    index: waveIndex++,
                    serviceIds: layer.slice(i, i + rolling.maxConcurrent),
                    mode: "rolling",
                    rollingConfig: rolling,
                });
            }
        }

        return { waves, mode: "rolling", totalServices: dag.nodes.size };
    }

    private buildCanaryPlan(dag: ServiceDag, canary: CanaryConfig): RolloutPlan {
        const waves: RolloutWave[] = [];
        const [firstLayer, ...restLayers] = dag.layers;

        if (firstLayer !== undefined && firstLayer.length > 0) {
            const canaryServiceId = firstLayer[0];
            if (canaryServiceId === undefined) {
                throw new Error("[FleetRolloutPlannerService] invariant violation: firstLayer is non-empty but index 0 is undefined");
            }
            // First service in first layer gets a canary wave
            waves.push({
                index: 0,
                serviceIds: [canaryServiceId],
                mode: "canary",
                canaryConfig: canary,
            });
            // Remaining services in first layer get ordered wave
            if (firstLayer.length > 1) {
                waves.push({
                    index: 1,
                    serviceIds: firstLayer.slice(1),
                    mode: "ordered",
                });
            }
        }

        // Rest of the DAG layers are ordered
        let offset = waves.length;
        for (const layer of restLayers) {
            waves.push({ index: offset++, serviceIds: layer, mode: "ordered" });
        }

        return { waves, mode: "canary", totalServices: dag.nodes.size };
    }
}
