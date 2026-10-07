import { describe, expect, it } from "vitest";

import {
	DEFAULT_INGRESS_PROVIDER,
	INGRESS_PROVIDERS,
	INGRESS_PROVIDER_TRAITS,
	isExternallyReachable,
} from "@repo/contracts-entities/entities/ingress/index";
import { apiEnvSchema } from "@repo/env";

/**
 * The ingress provider is NOT an env-var decision.
 *
 * ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────
 * The provider used to be declared in BOTH places: the local SQLite
 * `platform_settings` row `edge.mode` (written by the UI) AND a
 * `DEPLOYER_EDGE_MODE` env var used as a seed fallback. Whichever won depended
 * on whether a row happened to exist, so the same install could report a
 * different provider across restarts — and a stale env value could silently
 * override what the operator chose in the console.
 *
 * That ambiguity is now removed: the local DB is the ONLY store, and the
 * install default is code (`DEFAULT_INGRESS_PROVIDER`). This suite pins that
 * decision so the env key cannot quietly return — an env default is exactly the
 * kind of "harmless" re-addition that would restore the two-source problem.
 *
 * The earlier version of this file asserted the env schema ACCEPTED the four
 * providers; there is no env schema entry to accept any more, so the assertion
 * is inverted.
 */

/** The minimum the api schema needs to parse. */
function baseEnv(): Record<string, string> {
	return {
		NODE_ENV: "test",
		DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
		BETTER_AUTH_SECRET: "test-secret-value-for-parity-spec-only",
		NEXT_PUBLIC_API_URL: "http://localhost:3001",
		NEXT_PUBLIC_APP_URL: "http://localhost:3000",
	};
}

describe("ingress provider is DB-only (no env key)", () => {
	it("does NOT declare DEPLOYER_EDGE_MODE in the env schema", () => {
		// The regression guard. If someone re-adds the key "as a convenience
		// default", the DB row and the env var can disagree again and the
		// operator's console choice becomes unreliable.
		expect(Object.keys(apiEnvSchema.shape)).not.toContain("DEPLOYER_EDGE_MODE");
	});

	it("parses the api env WITHOUT any ingress-related key", () => {
		// A fresh install sets no provider variable at all; boot must still work.
		expect(apiEnvSchema.safeParse(baseEnv()).success).toBe(true);
	});

	it("defaults to the canonical default — the least-exposed provider", () => {
		// `local` is the only provider that cannot expose the machine, which is
		// why it is the safe value for an install nobody has configured yet. The
		// old default was `direct`, which published :80/:443 on every node.
		expect(DEFAULT_INGRESS_PROVIDER).toBe("local");
	});

	it("keeps the default the ONLY provider that needs no operator setup", () => {
		// A default that requires the operator to configure something first is a
		// default that produces a broken install. `local` is the only one whose
		// traits are all false, and that is why it is safe to default to.
		const traits = INGRESS_PROVIDER_TRAITS[DEFAULT_INGRESS_PROVIDER];
		expect(traits.requiresSetup).toBe(false);
		expect(traits.requiresPublicIp).toBe(false);
		expect(traits.requiresOpenInboundPorts).toBe(false);
		expect(traits.requiresProviderAccount).toBe(false);
	});

	it("orders the providers from least to most exposed", () => {
		// The ordering is load-bearing: pickers, warnings and "you are about to"
		// confirmations read it instead of hardcoding their own idea of which
		// choice is riskier.
		expect(INGRESS_PROVIDERS).toEqual(["local", "wireguard", "tunnel", "direct"]);
	});

	it("treats ONLY `local` as not externally reachable", () => {
		for (const provider of INGRESS_PROVIDERS) {
			expect(isExternallyReachable(provider)).toBe(provider !== "local");
		}
	});

	it("marks exactly the public provider as needing open inbound ports", () => {
		// `direct` is the only provider that opens the firewall. If a future
		// provider starts requiring inbound ports, this fails and the docs/UI
		// copy that promise "no open ports" must be revisited.
		const requiring = INGRESS_PROVIDERS.filter(
			(provider) => INGRESS_PROVIDER_TRAITS[provider].requiresOpenInboundPorts,
		);
		expect(requiring).toEqual(["direct"]);
	});

	it("marks exactly the public provider as needing a public IP", () => {
		const requiring = INGRESS_PROVIDERS.filter(
			(provider) => INGRESS_PROVIDER_TRAITS[provider].requiresPublicIp,
		);
		expect(requiring).toEqual(["direct"]);
	});

	it("does not flag `local` as binding a non-loopback port", () => {
		// `local` DOES bind a port — but only on loopback, so it is not exposure.
		// This is the distinction the old two-value model could not express, and
		// conflating the two is how "we bind a port" became "we are public".
		expect(INGRESS_PROVIDER_TRAITS.local.bindsNonLoopbackPort).toBe(false);
		expect(INGRESS_PROVIDER_TRAITS.direct.bindsNonLoopbackPort).toBe(true);
	});
});
