import type { Hlc } from "./hybrid-logical-clock";

/**
 * Observed-Remove Set — CRDT où "ajout concurrent à suppression" gagne.
 *
 * Chaque ajout porte un tag unique (HLC). Un remove ne tue que les tags
 * qu'il a observés. Idéal pour un set d'ACKs distribués.
 */
export class OrSet<T> {
    private readonly adds = new Map<T, Set<string>>();
    private readonly removes = new Map<T, Set<string>>();

    add(value: T, tag: Hlc): void {
        const tagKey = this.tagKey(tag);
        const tags = this.adds.get(value) ?? new Set();
        tags.add(tagKey);
        this.adds.set(value, tags);
    }

    remove(value: T): void {
        const observed = this.adds.get(value);
        if (!observed) return;
        const removed = this.removes.get(value) ?? new Set();
        for (const tag of observed) removed.add(tag);
        this.removes.set(value, removed);
    }

    has(value: T): boolean {
        const added = this.adds.get(value);
        if (!added || added.size === 0) return false;
        const removed = this.removes.get(value);
        if (!removed) return true;
        for (const tag of added) {
            if (!removed.has(tag)) return true;
        }
        return false;
    }

    values(): T[] {
        const out: T[] = [];
        for (const value of this.adds.keys()) {
            if (this.has(value)) out.push(value);
        }
        return out;
    }

    size(): number { return this.values().length; }

    private tagKey(hlc: Hlc): string {
        return `${hlc.wallMs.toString()}-${hlc.logical.toString()}-${hlc.nodeId}`;
    }
}