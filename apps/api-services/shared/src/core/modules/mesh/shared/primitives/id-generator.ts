import { randomUUID } from "node:crypto";

/**
 * Abstraction de génération d'identifiants — déterministe en test.
 */
export interface IdGenerator {
    uuid(): string;
}

export class SystemIdGenerator implements IdGenerator {
    uuid(): string { return randomUUID(); }
}

export class SequentialIdGenerator implements IdGenerator {
    private counter = 0;
    uuid(): string {
        this.counter += 1;
        const hex = this.counter.toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${hex}`;
    }
}

export const ID_GENERATOR_TOKEN = Symbol("IdGenerator");