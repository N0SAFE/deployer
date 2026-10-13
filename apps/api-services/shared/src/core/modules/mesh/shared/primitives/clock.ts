/**
 * Abstraction temporelle injectable.
 * Permet de rendre tous les services déterministes en test.
 */
export interface Clock {
    nowMs(): number;
    nowIso(): string;
}

export class SystemClock implements Clock {
    nowMs(): number { return Date.now(); }
    nowIso(): string { return new Date().toISOString(); }
}

export class FakeClock implements Clock {
    constructor(private currentMs = 0) {}
    nowMs(): number { return this.currentMs; }
    nowIso(): string { return new Date(this.currentMs).toISOString(); }
    advance(ms: number): void { this.currentMs += ms; }
    setTo(ms: number): void { this.currentMs = ms; }
}

export const CLOCK_TOKEN = Symbol("Clock");