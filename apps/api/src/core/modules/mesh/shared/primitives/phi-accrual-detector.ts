import type { Clock } from "./clock";

/**
 * Phi Accrual Failure Detector (Hayashibara et al., 2004).
 *
 * Au lieu d'un timeout binaire, calcule une probabilité continue de panne
 * à partir de l'historique des intervalles de heartbeat.
 *
 * φ(t) = -log10(P(prochain heartbeat > t))
 *  - φ < 1   : nœud sain
 *  - φ > 8   : nœud très probablement mort
 */
export class PhiAccrualDetector {
    private readonly intervals: number[] = [];
    private lastHeartbeatMs: number | null = null;

    constructor(
        private readonly clock: Clock,
        private readonly windowSize = 100,
        private readonly minStdDevMs = 50,
        private readonly initialIntervalMs = 1_000,
    ) {}

    heartbeat(): void {
        const now = this.clock.nowMs();
        if (this.lastHeartbeatMs !== null) {
            const interval = now - this.lastHeartbeatMs;
            this.intervals.push(interval);
            if (this.intervals.length > this.windowSize) this.intervals.shift();
        } else {
            this.intervals.push(this.initialIntervalMs);
        }
        this.lastHeartbeatMs = now;
    }

    phi(): number {
        if (this.lastHeartbeatMs === null) return 0;
        const elapsed = this.clock.nowMs() - this.lastHeartbeatMs;
        const { mean, stdDev } = this.computeStats();
        const safeStd = Math.max(stdDev, this.minStdDevMs);
        const exponent = -((elapsed - mean) / safeStd);
        const probability = 1 / (1 + Math.exp(exponent));
        const survival = 1 - probability;
        if (survival <= 0) return Number.POSITIVE_INFINITY;
        return -Math.log10(survival);
    }

    /** Verdict combiné — seuils typiques: 8=mort, 4=suspect. */
    verdict(suspectThreshold = 4, deadThreshold = 8): "alive" | "suspect" | "dead" {
        const value = this.phi();
        if (value >= deadThreshold) return "dead";
        if (value >= suspectThreshold) return "suspect";
        return "alive";
    }

    private computeStats(): { mean: number; stdDev: number } {
        if (this.intervals.length === 0) return { mean: this.initialIntervalMs, stdDev: this.minStdDevMs };
        const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
        const variance = this.intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / this.intervals.length;
        return { mean, stdDev: Math.sqrt(variance) };
    }
}