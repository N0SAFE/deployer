import { describe, expect, it } from "vitest";

import { INGRESS_PROVIDERS, type IngressProvider } from "@repo/contracts-entities/entities/ingress/index";

import {
	LOOPBACK_ADDRESS,
	describeIngressBinding,
	requiresContainerPath,
	resolveIngressBinding,
	type IngressBindingInput,
} from "./ingress-binding";

/**
 * The binding table, asserted per provider.
 *
 * These are the tests that would have caught the original defect: the platform
 * defaulted to `direct`, which binds every interface, so a fresh install was on
 * the public internet before anyone chose anything. The first case below states
 * the opposite as a requirement — the default provider binds LOOPBACK ONLY.
 */

/** A complete input with sensible defaults, so each case states only what it tests. */
function input(overrides: Partial<IngressBindingInput> & { provider: IngressProvider }): IngressBindingInput {
	return {
		entryPort: 80,
		tlsEnabled: false,
		overlayAddress: null,
		...overrides,
	};
}

describe("resolveIngressBinding", () => {
	it("binds LOOPBACK ONLY for `local` — the fresh-install default", () => {
		const result = resolveIngressBinding(input({ provider: "local" }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// The whole point: a port is bound, but only on the loopback interface,
		// so no packet from another machine can arrive.
		expect(result.binding.scope).toBe("loopback");
		expect(result.binding.bindAddress).toBe(LOOPBACK_ADDRESS);
		expect(result.binding.ports).toEqual([80]);
	});

	it("binds NOTHING for `tunnel` — the connector dials out", () => {
		const result = resolveIngressBinding(input({ provider: "tunnel" }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.binding.scope).toBe("none");
		expect(result.binding.bindAddress).toBeNull();
		expect(result.binding.ports).toEqual([]);
	});

	it("binds the overlay ADDRESS for `wireguard`", () => {
		const result = resolveIngressBinding(input({ provider: "wireguard", overlayAddress: "10.0.0.7" }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.binding.scope).toBe("address");
		expect(result.binding.bindAddress).toBe("10.0.0.7");
		expect(result.binding.ports).toEqual([80]);
	});

	it("FAILS `wireguard` when the node has no overlay address, rather than binding every interface", () => {
		const result = resolveIngressBinding(input({ provider: "wireguard", overlayAddress: null }));

		// The failure matters more than the shape: falling back to 0.0.0.0 here
		// would silently turn "private mesh only" into "public", which is the
		// exact class of bug this module exists to prevent.
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toBe("overlay-address-missing");
	});

	it("binds EVERY interface for `direct` — the only provider that does", () => {
		const result = resolveIngressBinding(input({ provider: "direct" }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.binding.scope).toBe("all-interfaces");
		// null means "Docker's default bind", i.e. every interface. Only correct
		// when combined with the scope, which is why callers switch on scope.
		expect(result.binding.bindAddress).toBeNull();
		expect(result.binding.ports).toEqual([80]);
	});

	it("publishes the TLS port too, for every provider that binds anything", () => {
		for (const provider of ["local", "wireguard", "direct"] as const) {
			const result = resolveIngressBinding(
				input({ provider, tlsEnabled: true, overlayAddress: "10.0.0.7" }),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(result.binding.ports).toEqual([80, 443]);
		}
	});

	it("does not publish 443 for `tunnel` even with TLS enabled", () => {
		const result = resolveIngressBinding(input({ provider: "tunnel", tlsEnabled: true }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		// TLS terminates at the provider in this mode; the node still binds nothing.
		expect(result.binding.ports).toEqual([]);
	});

	it("realizes the single-address scopes through the CONTAINER path", () => {
		// Swarm's PortConfig has no host-IP field, so `local`/`wireguard` cannot
		// be a swarm publish. This is the assertion that pins that fact.
		for (const provider of ["local", "wireguard"] as const) {
			const result = resolveIngressBinding(
				input({ provider, overlayAddress: "10.0.0.7" }),
			);
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(requiresContainerPath(result.binding)).toBe(true);
			expect(result.binding.viaSwarmHostMode).toBe(false);
		}
	});

	it("uses Swarm host mode only for `direct`, and never the container path", () => {
		const result = resolveIngressBinding(input({ provider: "direct" }));

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.binding.viaSwarmHostMode).toBe(true);
		expect(requiresContainerPath(result.binding)).toBe(false);
	});

	it("covers every declared provider — no provider silently resolves to nothing", () => {
		// A provider added to the canonical list without a case here would fall
		// through the switch and return undefined, binding nothing by accident.
		for (const provider of INGRESS_PROVIDERS) {
			const result = resolveIngressBinding(input({ provider, overlayAddress: "10.0.0.7" }));
			expect(result.ok, `provider '${provider}' must resolve`).toBe(true);
		}
	});

	it("treats a blank overlay address as missing", () => {
		const result = resolveIngressBinding(input({ provider: "wireguard", overlayAddress: "   " }));
		expect(result.ok).toBe(false);
	});
});

describe("describeIngressBinding", () => {
	it("states the bind address, not just the provider name", () => {
		const local = resolveIngressBinding(input({ provider: "local" }));
		expect(local.ok).toBe(true);
		if (!local.ok) return;
		const text = describeIngressBinding(local.binding, "local");
		// The log line must name the address: "binds a port" and "binds loopback"
		// are very different things to an operator reading a boot log.
		expect(text).toContain(LOOPBACK_ADDRESS);
		expect(text).toContain("80");
	});

	it("says 'binds nothing' rather than implying a loopback bind", () => {
		const tunnel = resolveIngressBinding(input({ provider: "tunnel" }));
		expect(tunnel.ok).toBe(true);
		if (!tunnel.ok) return;
		expect(describeIngressBinding(tunnel.binding, "tunnel")).toContain("binds nothing");
	});
});
