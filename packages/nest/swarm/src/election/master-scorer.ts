/**
 * MasterScorer — pure scoring + eligibility for the platform master election
 * (docs/swarm-orchestration/02 §3-§4).
 *
 * Candidates are normalized into `[0,1]` metrics (lower is better, except
 * `cpuHeadroom`/`stability` where higher is better). The weighted score is
 * lower-is-better; the current healthy master keeps a hysteresis bonus so it
 * is not thrashed by a marginally-better challenger.
 */

export interface MasterCandidateMetrics {
    nodeId: string;
    /** normalized latency (p50 RTT / budget, clamped [0,1]) — lower better */
    latency: number;
    /** normalized jitter ((p95-p50)/p50, clamped [0,1]) — lower better */
    jitter: number;
    /** memory pressure fraction used/limit [0,1] — lower better */
    memoryPressure: number;
    /** free vCPU fraction [0,1] — HIGHER better */
    cpuHeadroom: number;
    /** stability: 1 - failures/budget, clamped [0,1] — higher better */
    stability: number;
    /** already a swarm manager (quorum member) — required in most fleets */
    isManager: boolean;
    /** exact current master — receives the hysteresis bonus */
    isCurrentMaster: boolean;
}

export interface MasterScorerWeights {
    latency: number;
    jitter: number;
    memoryPressure: number;
    cpuHeadroom: number;
    stability: number;
    quorumFit: number;
    hysteresis: number;
}

export interface MasterScoreResult {
    nodeId: string;
    score: number;
    reasons: Partial<Record<keyof MasterScorerWeights, number>>;
    eligible: boolean;
}

export const DEFAULT_MASTER_SCORER_WEIGHTS: MasterScorerWeights = {
    latency: 0.3,
    jitter: 0.1,
    memoryPressure: 0.1,
    cpuHeadroom: 0.1,
    stability: 0.15,
    quorumFit: 0.15,
    hysteresis: 0.1,
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Candidates that are not swarm managers are ineligible as master. */
export function isEligibleAsMaster(candidate: MasterCandidateMetrics): boolean {
    if (!candidate.isManager) {
        return false;
    }
    if (candidate.latency >= 1) {
        return false;
    }
    return true;
}

/**
 * Weighted score (lower is better).
 * - `quorumFit`: inverts `isManager` (an extra manager costs quorum oddness).
 * - `hysteresis`: inverts `isCurrentMaster` (bonus for the incumbent).
 */
export function scoreCandidate(
    candidate: MasterCandidateMetrics,
    weights: MasterScorerWeights = DEFAULT_MASTER_SCORER_WEIGHTS,
): number {
    const contribution = {
        latency: weights.latency * clamp01(candidate.latency),
        jitter: weights.jitter * clamp01(candidate.jitter),
        memoryPressure: weights.memoryPressure * clamp01(candidate.memoryPressure),
        cpuHeadroom: weights.cpuHeadroom * (1 - clamp01(candidate.cpuHeadroom)),
        stability: weights.stability * (1 - clamp01(candidate.stability)),
        quorumFit: weights.quorumFit * (candidate.isManager ? 0 : 1),
        hysteresis: weights.hysteresis * (candidate.isCurrentMaster ? 0 : 1),
    };

    return Object.values(contribution).reduce((sum, value) => sum + value, 0);
}

export function buildMasterScoreResult(
    candidate: MasterCandidateMetrics,
    weights: MasterScorerWeights = DEFAULT_MASTER_SCORER_WEIGHTS,
): MasterScoreResult {
    const eligible = isEligibleAsMaster(candidate);
    return {
        nodeId: candidate.nodeId,
        score: eligible ? scoreCandidate(candidate, weights) : Number.POSITIVE_INFINITY,
        reasons: {
            latency: clamp01(candidate.latency),
            jitter: clamp01(candidate.jitter),
            memoryPressure: clamp01(candidate.memoryPressure),
            cpuHeadroom: clamp01(candidate.cpuHeadroom),
            stability: clamp01(candidate.stability),
            quorumFit: candidate.isManager ? 0 : 1,
            hysteresis: candidate.isCurrentMaster ? 0 : 1,
        },
        eligible,
    };
}

/**
 * Rank eligible candidates by ascending score, deterministic tie-break by
 * nodeId. Returns the winner (lowest score) or null when nobody is eligible.
 */
export function selectMasterWinner(
    candidates: MasterCandidateMetrics[],
    weights: MasterScorerWeights = DEFAULT_MASTER_SCORER_WEIGHTS,
): MasterCandidateMetrics | null {
    const eligible = candidates.filter(isEligibleAsMaster);
    if (eligible.length === 0) {
        return null;
    }
    const scored = eligible.map((candidate) => ({ candidate, score: scoreCandidate(candidate, weights) }));
    scored.sort((a, b) => {
        const byScore = a.score - b.score;
        if (Math.abs(byScore) > 1e-6) {
            return byScore;
        }
        return a.candidate.nodeId < b.candidate.nodeId ? -1 : a.candidate.nodeId > b.candidate.nodeId ? 1 : 0;
    });
    const winner = scored[0];
    return winner ? winner.candidate : null;
}