import { Duration } from "effect";
import { EgressPolicy, type EgressPolicy as Policy } from "@deployer/effect-infra";

/** The slice of the environment the egress policy reads. */
export type EgressEnv = {
	readonly NODE_ENV?: string | undefined;
	/** Operator switch: let probes reach private-range and (outside production) loopback targets. */
	readonly DEPLOYER_ALLOW_PRIVATE_PROBES?: string | undefined;
};

export type EgressPolicies = {
	/**
	 * Targets a user or tenant chooses: a custom domain, a deployed domain, an operator-declared
	 * public address. Public addresses only, unless the operator allows private probes.
	 */
	readonly external: Policy;
	/**
	 * Targets an operator typed: a mesh peer or a node address. Private LAN ranges are normal;
	 * loopback and link-local are refused in production. No redirects.
	 */
	readonly operator: Policy;
	/** Fixed third-party hosts the platform itself chooses (public IP echo, DNS-over-HTTPS). Strict, https only. */
	readonly fixedExternal: (hosts: readonly string[]) => Policy;
	/** For logs: how the two configurable policies were resolved. */
	readonly summary: string;
};

const parseFlag = (raw: string | undefined): boolean | undefined => {
	const value = raw?.trim().toLowerCase();
	if (value === undefined || value === "") return undefined;
	if (["1", "true", "yes", "on"].includes(value)) return true;
	if (["0", "false", "no", "off"].includes(value)) return false;
	return undefined;
};

/**
 * Resolve the three egress policies (NET-004 / SEC-013).
 *
 *   - Production, flag unset or false: `external` = public only; `operator` = `operatorTarget`.
 *   - Production, flag true: `external` is relaxed to private LAN ranges (never loopback or link-local).
 *   - Outside production the flag defaults to true so `*.localhost` domains and local peers keep
 *     working; an EXPLICIT false is honoured there too.
 *
 * Cloud metadata endpoints are refused under every combination, and redirects are never followed
 * for operator targets.
 */
export function resolveEgressPolicies(env: EgressEnv): EgressPolicies {
	const production = env.NODE_ENV === "production";
	const flag = parseFlag(env.DEPLOYER_ALLOW_PRIVATE_PROBES);
	const strict = production ? flag !== true : flag === false;
	const devClasses = ["unspecified", "multicast", "reserved"] as const;

	let external: Policy;
	let operator: Policy;
	if (!production && !strict) {
		// Local runs: loopback and private targets are the whole point.
		external = { ...EgressPolicy.userSupplied, denyPrivate: false, denyClasses: devClasses };
		operator = { ...EgressPolicy.operatorTarget, denyClasses: devClasses };
	} else if (production && flag === true) {
		external = { ...EgressPolicy.userSupplied, denyPrivate: false, denyClasses: EgressPolicy.operatorTarget.denyClasses };
		operator = EgressPolicy.operatorTarget;
	} else {
		external = EgressPolicy.userSupplied;
		operator = EgressPolicy.operatorTarget;
	}

	return {
		external,
		operator,
		fixedExternal: (hosts) => ({
			...EgressPolicy.userSupplied,
			schemes: ["https"],
			allowHosts: hosts,
			followRedirects: 0,
			timeout: Duration.seconds(5),
			maxBytes: 64 * 1024,
		}),
		summary: `external=${strict ? "public-only" : "private-allowed"} operator=${operator.denyClasses?.includes("loopback") === true ? "no-loopback" : "loopback-allowed"}`,
	};
}
