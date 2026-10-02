import { describe, expect, it, vi } from "vitest";

import { SetupGateService } from "./setup-gate.service";

/**
 * `managedWebEnabled()` is the bridge between the wizard's dashboard question
 * and the API's `MANAGED_WEB_APP_ENABLED` seed. Its contract is a THREE-state
 * answer, and the third state is the one that matters:
 *
 *   true   the operator asked for the dashboard
 *   false  the operator explicitly declined it (API-only install)
 *   null   the operator was NEVER ASKED (older client, or a restart where the
 *          payload is not retained) — the deployment's own default must stand
 *
 * Collapsing null into `false` would silently disable the dashboard on every
 * restart, which is why it is asserted separately.
 */
function makeGate(pending: unknown): SetupGateService {
	// Constructed directly: this test is about the payload projection, not the
	// persistence or the swarm convergence those dependencies drive.
	const gate = Object.create(SetupGateService.prototype) as SetupGateService;
	(gate as unknown as { pendingTrigger: unknown }).pendingTrigger = pending;
	return gate;
}

describe("SetupGateService.managedWebEnabled", () => {
	it("returns true when the operator chose the managed dashboard", () => {
		expect(makeGate({ strategy: "local", managedWeb: "managed" }).managedWebEnabled()).toBe(true);
	});

	it("returns false when the operator explicitly chose API-only", () => {
		// Distinct from null: this is a real decision and MUST be forwarded.
		expect(makeGate({ strategy: "local", managedWeb: "api-only" }).managedWebEnabled()).toBe(false);
	});

	it("returns null when the wizard never asked", () => {
		expect(makeGate({ strategy: "local" }).managedWebEnabled()).toBe(null);
	});

	it("returns null for a non-object payload rather than inventing an answer", () => {
		expect(makeGate(null).managedWebEnabled()).toBe(null);
		expect(makeGate(undefined).managedWebEnabled()).toBe(null);
		expect(makeGate("local").managedWebEnabled()).toBe(null);
	});

	it("ignores an unrecognized selection instead of coercing it", () => {
		// A value we do not model must NOT become `false` — that would turn a
		// forward-compatible unknown into "dashboard disabled".
		expect(makeGate({ managedWeb: "something-new" }).managedWebEnabled()).toBe(null);
	});
});

/**
 * The trigger payload is retained rather than awaited, because the API cannot
 * receive it during onboarding — that is what makes the controller's forward
 * best-effort instead of an error.
 */
describe("SetupGateService.triggerPayload", () => {
	it("retains the payload for the handover to deliver later", () => {
		const payload = { strategy: "local", name: "admin" };
		expect(makeGate(payload).triggerPayload()).toBe(payload);
	});

	it("is null before any trigger, so a restart delivers nothing", () => {
		expect(makeGate(null).triggerPayload()).toBe(null);
	});
});
