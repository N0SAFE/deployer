/**
 * Log append-only borné avec cursor watermarks.
 * Compaction par low-water-mark des consumers.
 */
export interface LogEntry<T> {
    readonly sequence: number;
    readonly payload: T;
    readonly recordedAtMs: number;
}

export class BoundedEventLog<T> {
    private readonly entries: LogEntry<T>[] = [];
    private nextSequence = 1;
    private readonly consumerWatermarks = new Map<string, number>();

    constructor(
        private readonly maxEntries = 10_000,
        private readonly retentionMs: number = 60 * 60 * 1000,
    ) {}

    append(payload: T, nowMs: number): LogEntry<T> {
        const entry: LogEntry<T> = {
            sequence: this.nextSequence++,
            payload,
            recordedAtMs: nowMs,
        };
        this.entries.push(entry);
        this.maybeCompact(nowMs);
        return entry;
    }

    readFrom(afterSequence: number, limit = 100): LogEntry<T>[] {
        const out: LogEntry<T>[] = [];
        for (const entry of this.entries) {
            if (entry.sequence > afterSequence) {
                out.push(entry);
                if (out.length >= limit) break;
            }
        }
        return out;
    }

    ackConsumer(consumerId: string, sequence: number): void {
        const current = this.consumerWatermarks.get(consumerId) ?? 0;
        if (sequence > current) this.consumerWatermarks.set(consumerId, sequence);
    }

    lastSequence(): number { return this.nextSequence - 1; }
    size(): number { return this.entries.length; }

    private maybeCompact(nowMs: number): void {
        const sizeOverflow = this.entries.length - this.maxEntries;
        if (sizeOverflow > 0) this.entries.splice(0, sizeOverflow);

        const ageCutoff = nowMs - this.retentionMs;
        let dropCount = 0;
        for (const entry of this.entries) {
            if (entry.recordedAtMs < ageCutoff) dropCount += 1;
            else break;
        }
        if (dropCount > 0) this.entries.splice(0, dropCount);

        if (this.consumerWatermarks.size > 0) {
            const lowWaterMark = Math.min(...this.consumerWatermarks.values());
            let safeDrop = 0;
            for (const entry of this.entries) {
                if (entry.sequence <= lowWaterMark) safeDrop += 1;
                else break;
            }
            if (safeDrop > 0) this.entries.splice(0, safeDrop);
        }
    }
}