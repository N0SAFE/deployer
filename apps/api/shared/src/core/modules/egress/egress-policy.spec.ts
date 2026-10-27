import { EgressPolicy } from "@deployer/effect-infra";
import { describe, expect, it } from "vitest";

import { resolveEgressPolicies } from "./egress-policy";

describe("resolveEgressPolicies", () => {
	it("production, flag unset: public-only for user targets, operatorTarget for operator targets", () => {
		const p = resolveEgressPolicies({ NODE_ENV: "production" });
		expect(p.external).toBe(EgressPolicy.userSupplied);
		expect(p.external.denyPrivate).toBe(true);
		expect(p.operator).toBe(EgressPolicy.operatorTarget);
		expect(p.operator.denyClasses).toContain("loopback");
	});

	it.each(["false", "0", "no", "off", "", "garbage"])("production with the flag %j stays strict", (flag) => {
		expect(resolveEgressPolicies({ NODE_ENV: "production", DEPLOYER_ALLOW_PRIVATE_PROBES: flag }).external.denyPrivate).toBe(true);
	});

	it.each(["true", "1", "yes", "on", "TRUE", " On "])("production with the flag %j relaxes user targets to private ranges, never loopback or link-local", (flag) => {
		const p = resolveEgressPolicies({ NODE_ENV: "production", DEPLOYER_ALLOW_PRIVATE_PROBES: flag });
		expect(p.external.denyPrivate).toBe(false);
		expect(p.external.denyClasses).toEqual(expect.arrayContaining(["loopback", "link-local"]));
		expect(p.external.denyClasses).not.toContain("private");
		expect(p.operator).toBe(EgressPolicy.operatorTarget);
	});

	it("outside production the default allows private and loopback so *.localhost domains keep working", () => {
		for (const env of [{ NODE_ENV: "development" }, { NODE_ENV: "test" }, {}]) {
			const p = resolveEgressPolicies(env);
			expect(p.external.denyClasses).not.toContain("loopback");
			expect(p.operator.denyClasses).not.toContain("loopback");
			expect(p.external.denyClasses).toEqual(expect.arrayContaining(["unspecified", "multicast", "reserved"]));
		}
	});

	it("an explicit false is honoured outside production too", () => {
		const p = resolveEgressPolicies({ NODE_ENV: "development", DEPLOYER_ALLOW_PRIVATE_PROBES: "false" });
		expect(p.external.denyPrivate).toBe(true);
		expect(p.operator.denyClasses).toContain("loopback");
	});

	it("invariants hold for every combination: metadata refused, operator targets never redirect", () => {
		for (const NODE_ENV of ["production", "development", undefined]) {
			for (const DEPLOYER_ALLOW_PRIVATE_PROBES of ["true", "false", undefined]) {
				const p = resolveEgressPolicies({ NODE_ENV, DEPLOYER_ALLOW_PRIVATE_PROBES });
				expect(p.external.denyMetadata).toBe(true);
				expect(p.operator.denyMetadata).toBe(true);
				expect(p.operator.followRedirects).toBe(0);
				expect(p.fixedExternal(["dns.google"]).denyMetadata).toBe(true);
			}
		}
	});

	it("fixedExternal is https-only, host-pinned, small and never redirects, whatever the flag", () => {
		const p = resolveEgressPolicies({ NODE_ENV: "development" }).fixedExternal(["dns.google"]);
		expect(p.schemes).toEqual(["https"]);
		expect(p.allowHosts).toEqual(["dns.google"]);
		expect(p.followRedirects).toBe(0);
		expect(p.denyPrivate).toBe(true);
		expect(p.maxBytes).toBeLessThanOrEqual(64 * 1024);
	});

	it("summarises the resolution for the log", () => {
		expect(resolveEgressPolicies({ NODE_ENV: "production" }).summary).toBe("external=public-only operator=no-loopback");
		expect(resolveEgressPolicies({ NODE_ENV: "development" }).summary).toBe("external=private-allowed operator=loopback-allowed");
	});
});
