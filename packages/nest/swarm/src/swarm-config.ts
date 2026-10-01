/**
 * Swarm configuration contracts — the DATA a swarm primitive needs.
 *
 * These are deliberately narrow: each one describes only the values a specific
 * primitive reads, so an app can satisfy it without adopting a whole
 * environment schema. That is what lets a second Nest app drive swarm with its
 * own variables instead of inheriting the first app's env contract.
 *
 * WHAT THIS PACKAGE DOES NOT SHIP
 * No defaults for platform behaviour, no quorum policy, no "which services
 * exist". Those are platform DECISIONS and live in the app that owns them.
 */

/**
 * Timings + thresholds for `SwarmLeadershipService`'s election loop.
 *
 * Every field has an operational meaning; none of them is a "sensible default"
 * this package is entitled to guess, because the right cadence depends on the
 * fleet's size and network. The app resolves them from its own environment.
 */
export interface SwarmElectionConfig {
	/** Evaluation cadence while the cluster looks stable (ms). */
	readonly evalStableMs: number;
	/** Evaluation cadence while a quorum problem or flap is suspected (ms). */
	readonly evalVolatileMs: number;
	/** Minimum spacing between two takeovers, anti-flap (ms). */
	readonly cooldownMs: number;
	/** Score margin a challenger must beat the incumbent by, to take over. */
	readonly deltaMaster: number;
	/** A master whose heartbeat is older than this is SUSPECT (ms). */
	readonly heartbeatTtlMs: number;
	/** Extra grace on top of the TTL before re-election is forced (ms). */
	readonly masterGraceMs: number;
}

/**
 * Where a joining node can reach THIS cluster, and how large the control plane
 * may grow.
 *
 * `controlPlaneCandidates` is a list because the advertised address is resolved
 * from several possible sources (an explicit swarm address, an overlay IP, the
 * node's public URL) and the first usable one wins. The package tries them in
 * order; it does not know or care which source produced them.
 */
export interface SwarmJoinConfig {
	/** Ordered candidate addresses for the cluster's control plane. */
	readonly controlPlaneCandidates: readonly (string | undefined)[];
	/**
	 * Target/maximum number of managers. `1` is refused by the package (it is
	 * not a quorum); an even value is rounded up to the next odd number.
	 */
	readonly quorumMax: number;
}

/**
 * First-run participation defaults, used ONLY before the wizard has persisted a
 * decision.
 *
 * Every field is optional: once `node_config.swarmConfig` exists it wins, so an
 * app that always drives setup can supply `{}`. Fields mirror the persisted
 * config so the merge in `effectiveConfig()` needs no translation.
 *
 * `overlayIp` is separate from `advertiseAddr` because it is a fallback for the
 * SAME purpose (what address peers should dial) resolved from a different
 * source — the app decides which source it trusts, then passes both.
 */
export interface SwarmParticipationDefaults {
	readonly mode?: "create" | "join";
	readonly policy?: "auto" | "manager" | "worker";
	readonly advertiseAddr?: string | null;
	readonly joinToken?: string | null;
	readonly joinAddrs?: readonly string[];
	readonly overlayIp?: string | null;
	/**
	 * Whether this deployment runs a swarm AT ALL.
	 *
	 * `false` means every platform service is owned by the deployment (compose
	 * or an operator): there is no supervisor to schedule anything, so no
	 * cluster is needed, and founding one would mutate the operator's Docker
	 * engine for nothing.
	 *
	 * The plain `dev` profile is exactly this — all `MANAGED_*_ENABLED=true`.
	 * Without the flag, its `SwarmParticipationService.converge()` ran
	 * `docker swarm init` on boot (because `node_config` already said
	 * `setup_done` from a previous run) and left a swarm manager running on the
	 * developer's machine:
	 *
	 *   SwarmBootstrapService: Swarm converged (boot) — state=active,
	 *     role=manager … master=sn6acv3hofym
	 *
	 * Absent/`true` keeps the previous behaviour, so a swarm-based deployment
	 * needs no change.
	 */
	readonly swarmManaged?: boolean;
}

/**
 * DI tokens for the config contracts.
 *
 * The package declares the tokens (and therefore the shape of what it needs);
 * the app provides the values. This keeps the dependency pointing the right way
 * — the package describes its requirements, it does not reach for the app's
 * environment — while still using ordinary NestJS injection instead of
 * factories that have to construct every collaborator by hand.
 *
 * `SwarmModule.forRoot({...})` / `forRootAsync({...})` is the supported way to
 * bind them; assembling these providers by hand in each app duplicated the
 * wiring and failed at runtime (not compile time) when a provider was missed.
 */
export const SWARM_ELECTION_CONFIG = "SWARM_ELECTION_CONFIG" as const;
export const SWARM_JOIN_CONFIG = "SWARM_JOIN_CONFIG" as const;
export const SWARM_PARTICIPATION_DEFAULTS = "SWARM_PARTICIPATION_DEFAULTS" as const;

/**
 * Tokens for the two OPTIONAL leadership hooks.
 *
 * Optional means "the app may supply a source/sink", not "inject undefined":
 * `SwarmModule` always binds both (to `null` when the app supplies nothing), so
 * the service's constructor parameters are satisfied either way and the
 * framework never has to resolve a token nobody declared.
 */
export const SWARM_METRICS_PROVIDER = "SWARM_METRICS_PROVIDER" as const;
export const SWARM_LEADERSHIP_EVENT_SINK = "SWARM_LEADERSHIP_EVENT_SINK" as const;
