/**
 * @fileoverview IngressProvider — how the internet reaches a stack's ingress.
 *
 * ── WHY THIS IS A VOCABULARY AND NOT A BOOLEAN ──────────────────────────────
 * The platform previously modelled this as a two-value enum (`direct` |
 * `tunnel`), and that was wrong in a way that mattered: `direct` was the
 * DEFAULT, and `direct` is defined by publishing :80/:443 on every node. So a
 * fresh install opened ports on every machine before the operator had made any
 * decision at all — the opposite of the platform's stated posture ("never have
 * a public IP, never open a port").
 *
 * The four providers below are PEERS. Each answers "how does a client packet
 * reach Traefik?" differently, and none is a special case of another:
 *
 *   local     — a client on the SAME MACHINE. Traefik binds LOOPBACK only.
 *               Nothing is reachable off-box. This is what a fresh install
 *               gets: zero public surface, zero provider account, zero DNS.
 *   wireguard — a client on the PRIVATE mesh. Traefik binds its overlay
 *               address, so only mesh peers can reach it. No public IP, and
 *               the exposure is scoped to machines the operator enrolled.
 *   tunnel    — a client anywhere. A connector dials OUT to the provider, so
 *               the node accepts no inbound connection at all. Needs a
 *               provider account (Cloudflare Tunnel or equivalent).
 *   direct    — a client anywhere, over the public internet. DNS points at the
 *               node and Traefik binds :80/:443 on a public interface. This is
 *               the ONLY provider that requires a public IP and open inbound
 *               ports, which is why it must be opted into, never defaulted to.
 *
 * ── ORDER IS LOAD-BEARING ───────────────────────────────────────────────────
 * `INGRESS_PROVIDERS` is ordered from least to most exposure. Anything that
 * needs to rank or present them (a picker, a warning, a "you are about to"
 * confirmation) reads that order instead of hardcoding its own, so the two can
 * never disagree about which choice is the riskier one.
 */

import z from 'zod/v4'

/**
 * The four ways a client can reach the stack's ingress.
 *
 * Ordered least → most exposed (see `INGRESS_PROVIDERS`).
 */
export const ingressProviderSchema = z.enum(['local', 'wireguard', 'tunnel', 'direct'])
export type IngressProvider = z.output<typeof ingressProviderSchema>

/** Every provider, least-exposed first. The canonical ordering. */
export const INGRESS_PROVIDERS = ['local', 'wireguard', 'tunnel', 'direct'] as const

/**
 * The default for a fresh install.
 *
 * `local` is the only defensible default: it is the one provider that cannot
 * expose the machine to anyone. Every other choice is an operator decision that
 * requires something (a mesh identity, a provider account, a public IP), so
 * defaulting to any of them would mean a machine that is reachable before
 * anyone asked for it to be.
 */
export const DEFAULT_INGRESS_PROVIDER: IngressProvider = 'local'

/**
 * What a provider requires of the machine and the operator.
 *
 * Kept as DATA rather than as conditionals scattered across supervisors: the
 * UI, the reachability checks and the supervisors all need the same answers, and
 * three copies of "does this provider need a public IP?" is three chances to
 * disagree. Nothing here reads env or the database — it describes the provider,
 * not the current install.
 */
export interface IngressProviderTraits {
	/**
	 * Whether the ingress binds a port on a NON-loopback interface.
	 *
	 * This is the security-relevant bit: `local` binds a port, but only on
	 * loopback, so no packet from another machine can arrive. Treating
	 * "publishes a port" as the exposure test would wrongly flag `local`.
	 */
	bindsNonLoopbackPort: boolean
	/** Whether the machine must have a globally routable address. */
	requiresPublicIp: boolean
	/** Whether inbound ports must be open in the firewall / provider. */
	requiresOpenInboundPorts: boolean
	/** Whether a third-party provider account is needed. */
	requiresProviderAccount: boolean
	/** Whether an operator action is needed before this provider works. */
	requiresSetup: boolean
}

/**
 * Traits per provider — the single source of truth for what each one costs.
 *
 * `local` is deliberately all-false: it is the baseline a fresh install gets
 * with no decisions made, and anything that reports "setup required" on a
 * brand-new install is reporting a bug.
 */
export const INGRESS_PROVIDER_TRAITS: Record<IngressProvider, IngressProviderTraits> = {
	local: {
		bindsNonLoopbackPort: false,
		requiresPublicIp: false,
		requiresOpenInboundPorts: false,
		requiresProviderAccount: false,
		requiresSetup: false,
	},
	wireguard: {
		// Binds the overlay address: reachable by enrolled peers, not by the
		// public internet. No public IP and no inbound firewall rule on the
		// public interface — the UDP listener is the mesh's own transport.
		bindsNonLoopbackPort: true,
		requiresPublicIp: false,
		requiresOpenInboundPorts: false,
		requiresProviderAccount: false,
		// Needs an overlay IP and a peer list before it can serve anything.
		requiresSetup: true,
	},
	tunnel: {
		// The connector dials OUT and holds the connection, so the node accepts
		// no inbound connection and binds nothing.
		bindsNonLoopbackPort: false,
		requiresPublicIp: false,
		requiresOpenInboundPorts: false,
		requiresProviderAccount: true,
		requiresSetup: true,
	},
	direct: {
		bindsNonLoopbackPort: true,
		requiresPublicIp: true,
		requiresOpenInboundPorts: true,
		requiresProviderAccount: false,
		requiresSetup: true,
	},
}

/** Traits of `provider`, with no lookup at the call site. */
export function ingressProviderTraits(provider: IngressProvider): IngressProviderTraits {
	return INGRESS_PROVIDER_TRAITS[provider]
}

/**
 * Whether the ingress accepts connections from outside this machine.
 *
 * The one predicate every consumer should use instead of comparing the provider
 * to a literal: `local` binds a port but is NOT externally reachable, which is
 * the distinction the old two-value model could not express.
 */
export function isExternallyReachable(provider: IngressProvider): boolean {
	return provider !== 'local'
}
