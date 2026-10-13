/**
 * The node's state, DERIVED from facts rather than announced by a phase machine.
 *
 * ── WHY DERIVED ─────────────────────────────────────────────────────────────
 * The previous design had a process publish "I am in phase X", which meant the
 * answer was only available while that process was alive — precisely not the
 * case when an operator is asking. State derived from two durable facts
 * instead:
 *
 *   - `node_config.setupState`   (a local row — readable with nothing running)
 *   - whether the platform is answering
 *
 * is correct even when everything is down, which is when the question is asked.
 *
 * This is a PURE function so the CLI, the BFF roll-up and any future surface
 * cannot drift into three ideas of what "degraded" means.
 */

/** The platform's own view of itself, as the BFF's health roll-up reports it. */
export type PlatformHealthState = "healthy" | "degraded" | "unreachable";

/** What the local configuration says. Mirrors `node_config.setupState`. */
export type SetupState =
	| "not_started"
	| "setup_in_progress"
	| "setup_done"
	| "upgrade_pending"
	| "upgrade_in_progress"
	| "upgrade_failed";

/**
 * The states an operator acts on.
 *
 * Each has a DIFFERENT remedy, which is the whole reason they are distinct:
 * `INACTIVE` needs onboarding, `STOPPED` needs a start, `DEGRADED` needs nothing
 * (the swarm is already restarting it), `FAILED` needs diagnosis.
 */
export type NodeState =
	| "inactive" // never configured — run the configurator flow
	| "provisioning" // a start/upgrade is in flight
	| "healthy" // configured and every service is up
	| "degraded" // configured, running, at least one service unhealthy
	| "stopped" // configured, nothing running
	| "failed"; // an upgrade or provisioning failure

export interface NodeStateFacts {
	/** `node_config.setupState`, or `null` when there is no row at all. */
	readonly setupState: SetupState | null;
	/**
	 * The platform's own answer, or `null` when the BFF did not respond.
	 *
	 * `null` is NOT "degraded": a BFF that does not answer usually means nothing
	 * is running, which is `stopped`, not a partly-broken platform.
	 */
	readonly platform: PlatformHealthState | null;
}

export interface NodeStateVerdict {
	readonly state: NodeState;
	/** One line the operator can act on. */
	readonly detail: string;
}

/**
 * Derive the state. Pure — no I/O, no logging, no defaults from the environment.
 *
 * The order of the checks matters and encodes the semantics:
 *
 *   1. no configuration at all      → inactive  (nothing to start)
 *   2. an in-flight operation       → provisioning
 *   3. a failed operation           → failed    (beats "unreachable")
 *   4. configured but silent        → stopped   (the expected resting state)
 *   5. configured and answering     → healthy / degraded
 */
export function deriveNodeState(facts: NodeStateFacts): NodeStateVerdict {
	const { setupState, platform } = facts;

	if (setupState === null || setupState === "not_started") {
		return {
			state: "inactive",
			detail: "This node has never been configured. Run `deployer start` to begin.",
		};
	}

	if (setupState === "setup_in_progress" || setupState === "upgrade_in_progress") {
		return {
			state: "provisioning",
			detail: "An operation is in progress.",
		};
	}

	// A failed upgrade is reported even when the platform ANSWERS: the answer is
	// about the old version, so "healthy" would hide the thing the operator must
	// act on.
	if (setupState === "upgrade_failed") {
		return {
			state: "failed",
			detail: "The last upgrade failed. Run `deployer doctor`.",
		};
	}

	if (platform === null || platform === "unreachable") {
		return {
			state: "stopped",
			detail: "Configuration is present but nothing is running. Run `deployer start`.",
		};
	}

	if (platform === "healthy") {
		return { state: "healthy", detail: "Every service is healthy." };
	}

	return {
		state: "degraded",
		detail: "At least one service is unhealthy. Run `deployer status` for the list.",
	};
}

/** Exit code for a state, so a script can branch without parsing output. */
export function exitCodeForState(state: NodeState): number {
	switch (state) {
		case "healthy":
			return 0;
		case "inactive":
			return 3;
		case "degraded":
		case "failed":
			return 4;
		case "stopped":
			// "No platform" is an engine/availability condition, which is what the
			// CLI documents code 5 for.
			return 5;
		case "provisioning":
			// In flight is not a failure; a caller that polled again would succeed.
			return 0;
	}
}
