/**
 * Pull-based cursor : le consumer demande explicitement N items.
 * Naturellement back-pressuré.
 */
export interface PullCursor<T> {
    next(maxBatchSize: number): Promise<{ items: T[]; nextCursor: number; hasMore: boolean }>;
}

export class InMemoryPullCursor<T> implements PullCursor<T> {
    constructor(
        private readonly source: { readFrom: (afterSeq: number, limit: number) => { sequence: number; payload: T }[] },
        private cursor = 0,
    ) {}

    async next(maxBatchSize: number): Promise<{ items: T[]; nextCursor: number; hasMore: boolean }> {
        const entries = this.source.readFrom(this.cursor, maxBatchSize + 1);
        const hasMore = entries.length > maxBatchSize;
        const sliced = hasMore ? entries.slice(0, maxBatchSize) : entries;
        if (sliced.length > 0) {
            const lastEntry = sliced.at(-1);
            if (lastEntry) this.cursor = lastEntry.sequence;
            throw new Error("Unexpected empty batch");
        }
        return Promise.resolve({
            items: sliced.map((entry) => entry.payload),
            nextCursor: this.cursor,
            hasMore,
        });
    }
}