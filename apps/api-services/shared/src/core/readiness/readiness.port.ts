/**
 * Readiness probe PORT — the seam that inverts the dependency between the
 * gateway/orchestrator (core) and the health module (product).
 *
 * WHY THIS FILE EXISTS
 * The readiness route is registered on the Express gateway BEFORE Nest boots,
 * so it must answer during startup. But the readiness INDICATORS depend on the
 * global Postgres pool and the mesh repositories, which only exist in the
 * MAIN-APP container — a separate Nest application. The gateway therefore
 * cannot compute readiness itself; it has to reach into that other container.
 *
 * That reach is exactly where a layering violation creeps in: if the
 * orchestrator imported `ReadinessService` from `modules/health/`, then CORE
 * would depend on a PRODUCT module (SC7: forbidden — core must not depend on
 * modules). Instead the CONSUMER declares the interface it needs (this port,
 * which lives in core) and the module IMPLEMENTS it. The orchestrator resolves
 * the token, never the class, so core has no compile-time knowledge of the
 * health module at all.
 *
 * The module owns the IMPLEMENTATION (Terminus wiring, indicators, per-probe
 * caching); this file owns only the CONTRACT they agree on.
 */

/** The wire shape of the readiness probe response. */
export interface ReadinessResult {
	/** HTTP status to send: 200 when every indicator is up, 503 otherwise. */
	statusCode: number;
	body: {
		status: "ok" | "error";
		/** Per-indicator detail, present only for the components that reported. */
		info?: Record<string, unknown>;
		/** Present only when at least one indicator failed. */
		error?: Record<string, unknown>;
		checkedAt: string;
	};
}

/**
 * What the gateway needs from a readiness probe. Implemented by
 * `ReadinessService` in the health module and resolved by this token from the
 * main-app container.
 */
export interface IReadinessProbe {
	/**
	 * Run every readiness indicator.
	 *
	 * MUST NOT throw: "a dependency is down" is a legitimate answer to a
	 * readiness question, so a failure is a 503 RESULT rather than an error.
	 */
	probe(): Promise<ReadinessResult>;
}

/**
 * DI token for {@link IReadinessProbe}.
 *
 * A string token rather than the class itself, so resolving it does not
 * require importing the implementation. `HealthModule` binds it to the
 * `ReadinessService` instance with `useExisting`.
 */
export const READINESS_PROBE = "READINESS_PROBE" as const;
