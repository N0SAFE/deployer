import type { HealthIndicatorResult } from "@nestjs/terminus";

/**
 * One indicator's contribution, in Terminus' own shape.
 *
 * Kept as a type alias rather than a re-declaration: Terminus' result shape
 * (`{ <name>: { status, ...detail } }`) is what clients and the Terminus UI
 * already understand, and inventing a parallel shape here would mean writing a
 * translator back to it — which is how "the output is not useful" happens.
 */
export type IndicatorResult = HealthIndicatorResult;

/** The verdict for a single indicator, flattened for the stream. */
export type IndicatorSnapshot = {
	/** Indicator name, e.g. `"database"`. Also its key in the Terminus payload. */
	readonly name: string;
	/** `up` when the check passed, `down` when it did not. */
	readonly status: "up" | "down";
	/** How long the check took. Populated for every indicator, up or down. */
	readonly latencyMs: number;
	/** Present when the check failed — the actionable reason. */
	readonly message?: string;
	/** Extra facts the check learned (version, counts, memory figures, …). */
	readonly detail?: Record<string, unknown>;
	/** When `up`, a successful result; when `down`, the reason. */
	readonly reason?: string;
}

/**
 * The whole picture at one instant.
 *
 * This is what streams. `critical` vs `degraded` is a distinction the CALLER
 * decides: a service declares which indicators are required, and this type only
 * reports what it found. That keeps the registry free of per-service policy.
 */
export type HealthSnapshot = {
	/** `up` only when EVERY indicator is up. */
	readonly status: "up" | "down";
	/** Same shape Terminus returns, so `/health/detailed` can pass it straight through. */
	readonly info: Record<string, { status: "up"; [key: string]: unknown }>;
	readonly error: Record<string, { status: "down"; message?: string; [key: string]: unknown }>;
	readonly details: Record<string, { status: "up" | "down"; [key: string]: unknown }>;
	/** Per-indicator verdicts, in declaration order. */
	readonly indicators: IndicatorSnapshot[];
	/** When the snapshot was produced. */
	readonly checkedAt: string;
	/** Total wall time for the pass. */
	readonly durationMs: number;
}
