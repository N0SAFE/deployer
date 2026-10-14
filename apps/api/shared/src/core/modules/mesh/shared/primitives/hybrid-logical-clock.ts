import type { Clock } from "./clock";

import { AppError } from "@repo/errors";
/**
 * Hybrid Logical Clock (Kulkarni et al., 2014).
 *
 * Combine wall-clock (lisible humainement, proche de la réalité)
 * et compteur logique (pour préserver la causalité).
 *
 * Utilisé par CockroachDB, MongoDB, YugabyteDB.
 */
export interface Hlc {
    readonly wallMs: number;
    readonly logical: number;
    readonly nodeId: string;
}

export function compareHlc(a: Hlc, b: Hlc): number {
    if (a.wallMs !== b.wallMs) return a.wallMs - b.wallMs;
    if (a.logical !== b.logical) return a.logical - b.logical;
    return a.nodeId.localeCompare(b.nodeId);
}

export function serializeHlc(hlc: Hlc): string {
    return `${hlc.wallMs.toString()}.${hlc.logical.toString()}.${hlc.nodeId}`;
}

export function deserializeHlc(input: string): Hlc {
    const [wall, logical, nodeId] = input.split(".");
    if (!wall || !logical || !nodeId) {
        throw new AppError(`Invalid HLC string: ${input}`, `INTERNAL_ERROR`);
    }
    return {
        wallMs: Number(wall),
        logical: Number(logical),
        nodeId,
    };
}

export class HybridLogicalClock {
    private wallMs = 0;
    private logical = 0;

    constructor(
        private readonly nodeId: string,
        private readonly clock: Clock,
    ) {}

    /** Génère un HLC pour un événement local. */
    tick(): Hlc {
        const physical = this.clock.nowMs();
        if (physical > this.wallMs) {
            this.wallMs = physical;
            this.logical = 0;
        } else {
            this.logical += 1;
        }
        return { wallMs: this.wallMs, logical: this.logical, nodeId: this.nodeId };
    }

    /** Met à jour à la réception d'un message distant. */
    observe(remote: Hlc): Hlc {
        const physical = this.clock.nowMs();
        const maxWall = Math.max(this.wallMs, remote.wallMs, physical);

        if (maxWall === this.wallMs && maxWall === remote.wallMs) {
            this.logical = Math.max(this.logical, remote.logical) + 1;
        } else if (maxWall === this.wallMs) {
            this.logical += 1;
        } else if (maxWall === remote.wallMs) {
            this.logical = remote.logical + 1;
        } else {
            this.logical = 0;
        }

        this.wallMs = maxWall;
        return { wallMs: this.wallMs, logical: this.logical, nodeId: this.nodeId };
    }

    snapshot(): Hlc {
        return { wallMs: this.wallMs, logical: this.logical, nodeId: this.nodeId };
    }
}