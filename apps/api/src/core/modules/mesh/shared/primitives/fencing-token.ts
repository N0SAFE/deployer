/**
 * Fencing token monotone — empêche le split-brain quand une lease expire
 * et qu'un ancien détenteur retarde une écriture.
 */
export class FencingTokenIssuer {
    private current = 0;
    next(): number { this.current += 1; return this.current; }
    peek(): number { return this.current; }
    observe(remote: number): void { if (remote > this.current) this.current = remote; }
}

export interface FencedOperation {
    readonly fencingToken: number;
}

export function isFencedOperationValid(op: FencedOperation, lastSeenToken: number): boolean {
    return op.fencingToken >= lastSeenToken;
}