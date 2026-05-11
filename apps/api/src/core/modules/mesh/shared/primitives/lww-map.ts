import { compareHlc, type Hlc } from "./hybrid-logical-clock";

/**
 * Last-Write-Wins Map — un CRDT trivialement réconciliable.
 *
 * Propriétés de merge:
 *  - commutatif:  merge(a, b) === merge(b, a)
 *  - associatif:  merge(merge(a,b),c) === merge(a,merge(b,c))
 *  - idempotent:  merge(a, a) === a
 */
export interface LwwEntry<V> {
    readonly value: V;
    readonly hlc: Hlc;
    readonly tombstone: boolean;
}

export class LwwMap<K, V> {
    private readonly entries = new Map<K, LwwEntry<V>>();

    set(key: K, value: V, hlc: Hlc): boolean {
        const existing = this.entries.get(key);
        if (existing && compareHlc(hlc, existing.hlc) <= 0) {
            return false;
        }
        this.entries.set(key, { value, hlc, tombstone: false });
        return true;
    }

    delete(key: K, hlc: Hlc): boolean {
        const existing = this.entries.get(key);
        if (existing && compareHlc(hlc, existing.hlc) <= 0) {
            return false;
        }
        const previousValue = existing?.value as V;
        this.entries.set(key, { value: previousValue, hlc, tombstone: true });
        return true;
    }

    get(key: K): V | undefined {
        const entry = this.entries.get(key);
        return entry && !entry.tombstone ? entry.value : undefined;
    }

    has(key: K): boolean {
        const entry = this.entries.get(key);
        return entry !== undefined && !entry.tombstone;
    }

    *values(): IterableIterator<V> {
        for (const entry of this.entries.values()) {
            if (!entry.tombstone) yield entry.value;
        }
    }

    *liveEntries(): IterableIterator<[K, V]> {
        for (const [key, entry] of this.entries) {
            if (!entry.tombstone) yield [key, entry.value];
        }
    }

    /** Merge un autre LwwMap dans celui-ci. Retourne le nombre de clés modifiées. */
    merge(other: LwwMap<K, V>): number {
        let changed = 0;
        for (const [key, entry] of other.entries) {
            const existing = this.entries.get(key);
            if (!existing || compareHlc(entry.hlc, existing.hlc) > 0) {
                this.entries.set(key, entry);
                changed += 1;
            }
        }
        return changed;
    }

    /** Compaction : supprime les tombstones plus vieilles que la HLC seuil. */
    compactTombstones(olderThan: Hlc): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (entry.tombstone && compareHlc(entry.hlc, olderThan) < 0) {
                this.entries.delete(key);
                removed += 1;
            }
        }
        return removed;
    }

    size(): number {
        let count = 0;
        for (const entry of this.entries.values()) {
            if (!entry.tombstone) count += 1;
        }
        return count;
    }
}