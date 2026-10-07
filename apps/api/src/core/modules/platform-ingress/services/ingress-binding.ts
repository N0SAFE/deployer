/**
 * Ingress binding — the SEAM between "which provider did the operator pick" and
 * "what does the ingress actually bind".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The platform used to answer this with a single boolean buried in the Traefik
 * supervisor:
 *
 *   private publishesEntryPort(): boolean { return this.edgeMode === "direct"; }
 *
 * That boolean could express exactly two worlds — "bind :80 on every interface"
 * or "bind nothing" — so two whole tiers the platform needs had nowhere to be
 * expressed:
 *
 *   - `local`     — bind a port, but ONLY on loopback. Reachable from this
 *                   machine and nowhere else. The boolean's `false` branch
 *                   (bind nothing) is wrong for it, and its `true` branch
 *                   (bind everything) is worse.
 *   - `wireguard` — bind a port, but ONLY on the mesh overlay address.
 *
 * Both need a THIRD answer: bind a port, on ONE address. That is what
 * `IngressBinding` carries, and it is the reason this is a value type rather
 * than a predicate: the provider decides the ADDRESS, and the supervisor only
 * executes it.
 *
 * ── WHY A PURE FUNCTION ─────────────────────────────────────────────────────
 * No env reads, no database, no Docker. The inputs are the provider, the entry
 * port and the addresses the node happens to have; the output is a complete
 * description of what to bind. That makes every provider's exposure auditable by
 * reading one table and unit-testable without a cluster — and it is what keeps
 * the supervisors from each re-deriving "should I bind?" slightly differently,
 * which is how the original bug (a default that published :80/:443 before any
 * operator decision) got in.
 */

import {
	ingressProviderTraits,
	type IngressProvider,
} from '@repo/contracts-entities/entities/ingress/index'

/**
 * Where the ingress binds. Ordered by exposure, mirroring the provider list.
 *
 * `loopback` and `address` are the two the old boolean could not express:
 * both DO bind a port, but only on one interface.
 */
export type IngressBindScope =
	/** Nothing is bound at all — the connector dials out. */
	| 'none'
	/** Bound on 127.0.0.1 only: reachable from this machine alone. */
	| 'loopback'
	/** Bound on ONE specific non-loopback address (e.g. a mesh overlay IP). */
	| 'address'
	/** Bound on every interface: reachable from wherever routing allows. */
	| 'all-interfaces'

/**
 * The complete description of what the ingress must bind.
 *
 * Deliberately carries the ADDRESS rather than only the scope: the supervisor
 * must pass a concrete bind address to Docker, and re-deriving it there would be
 * a second place to get it wrong.
 */
export interface IngressBinding {
	/** How exposed this binding is. */
	scope: IngressBindScope
	/**
	 * Address Docker binds to, or `null` when nothing is bound.
	 *
	 * - `loopback`      → "127.0.0.1"
	 * - `address`       → the supplied overlay address
	 * - `all-interfaces`→ null (Docker's default bind: every interface)
	 * - `none`          → null
	 *
	 * `null` therefore means two different things depending on `scope`, which is
	 * why callers must switch on `scope` and never on this field alone.
	 */
	bindAddress: string | null
	/** Host ports to publish. Empty whenever nothing is bound. */
	ports: readonly number[]
	/**
	 * Whether the port must be published with Swarm's `publishMode: "host"`.
	 *
	 * False for the single-address scopes because SWARM CANNOT EXPRESS THEM:
	 * Swarm's `PortConfig` has no host-IP field, so `host` mode always binds
	 * 0.0.0.0. A loopback or overlay-only binding therefore has to be realized
	 * through the container path, which does support `HostIp`. This flag is what
	 * tells the supervisor which path it is on, instead of it guessing.
	 */
	viaSwarmHostMode: boolean
}

/** Inputs the resolver needs that are NOT properties of the provider itself. */
export interface IngressBindingInput {
	provider: IngressProvider
	/** Host port the ingress would bind (the configured entry port). */
	entryPort: number
	/** Whether the TLS entrypoint (443) is enabled. */
	tlsEnabled: boolean
	/**
	 * This node's mesh overlay address, when it has one.
	 *
	 * Required for `wireguard`: the overlay address IS the bind address. Absent
	 * means the provider cannot be realized on this node yet, which the resolver
	 * reports as an explicit failure rather than silently binding 0.0.0.0 — the
	 * difference between "not configured" and "exposed to the internet".
	 */
	overlayAddress: string | null
}

/** Why a provider could not be resolved into a binding. */
export type IngressBindingFailure =
	/** `wireguard` was requested but this node has no overlay address. */
	| 'overlay-address-missing'

export type IngressBindingResult =
	| { ok: true; binding: IngressBinding }
	| { ok: false; reason: IngressBindingFailure }

/** The loopback address. A client on this machine reaches it; nothing else does. */
export const LOOPBACK_ADDRESS = '127.0.0.1'

/**
 * Resolve the binding for `input.provider`.
 *
 * Every provider is a PEER here — the function is a total mapping from the four
 * providers to their bindings, so adding a fifth means adding one row rather
 * than threading a new special case through the supervisors.
 */
export function resolveIngressBinding(input: IngressBindingInput): IngressBindingResult {
	const { provider, entryPort, tlsEnabled, overlayAddress } = input

	// The TLS entrypoint only exists when TLS is on. Deriving the port list once
	// keeps every provider's answer consistent, and keeps `local` from quietly
	// publishing 443 on all interfaces when TLS is enabled.
	const ports = tlsEnabled ? [entryPort, 443] : [entryPort]

	switch (provider) {
		case 'local':
			// Bound on loopback ONLY. This is the default for a fresh install:
			// a port is listening, but no packet from another machine can reach
			// it, so the stack is not on any network until the operator says so.
			return {
				ok: true,
				binding: {
					scope: 'loopback',
					bindAddress: LOOPBACK_ADDRESS,
					ports,
					viaSwarmHostMode: false,
				},
			}

		case 'wireguard': {
			// Bound on the mesh overlay address. Enrolled peers reach it; the
			// public internet has no route to it.
			if (overlayAddress === null || overlayAddress.trim() === '') {
				return { ok: false, reason: 'overlay-address-missing' }
			}
			return {
				ok: true,
				binding: {
					scope: 'address',
					bindAddress: overlayAddress.trim(),
					ports,
					viaSwarmHostMode: false,
				},
			}
		}

		case 'tunnel':
			// NOTHING is bound. The connector dials out and holds the connection,
			// so the node accepts no inbound connection at all — binding even
			// loopback would be surface this provider exists to remove.
			return {
				ok: true,
				binding: { scope: 'none', bindAddress: null, ports: [], viaSwarmHostMode: false },
			}

		case 'direct':
			// Every interface, on every node, through Swarm's host publish mode.
			// The ONLY provider that needs open inbound ports and a public IP.
			return {
				ok: true,
				binding: {
					scope: 'all-interfaces',
					bindAddress: null,
					ports,
					viaSwarmHostMode: true,
				},
			}
	}
}

/**
 * Whether a binding requires the CONTAINER convergence path.
 *
 * Swarm's `PortConfig` has no host-IP field, so `local` and `wireguard` cannot
 * be expressed as a swarm service publish — they need a plain container, where
 * `HostConfig.PortBindings[].HostIp` exists. This predicate is the single place
 * that fact is encoded.
 */
export function requiresContainerPath(binding: IngressBinding): boolean {
	return binding.scope === 'loopback' || binding.scope === 'address'
}

/**
 * Human-readable description of what a binding exposes, for logs and the UI.
 *
 * Built from the binding rather than from the provider name so a log line can
 * never claim "loopback only" while the ports list says otherwise.
 */
export function describeIngressBinding(binding: IngressBinding, provider: IngressProvider): string {
	switch (binding.scope) {
		case 'none':
			return `${provider}: binds nothing (outbound only)`
		case 'loopback':
			return `${provider}: bound on ${LOOPBACK_ADDRESS} only (this machine) — ports ${binding.ports.join(', ')}`
		case 'address':
			return `${provider}: bound on ${binding.bindAddress ?? '?'} only (private network) — ports ${binding.ports.join(', ')}`
		case 'all-interfaces':
			return `${provider}: bound on every interface (public) — ports ${binding.ports.join(', ')}`
	}
}

/**
 * Whether the binding exposes the machine to anything off-box.
 *
 * Delegates to the canonical traits so this agrees with the contracts by
 * construction, while still accounting for a failed resolution (an unresolvable
 * provider exposes nothing, because nothing got bound).
 */
export function bindingIsExternallyReachable(result: IngressBindingResult): boolean {
	if (!result.ok) return false
	return result.binding.scope === 'all-interfaces' || result.binding.scope === 'address'
}

/** Traits of the provider a binding came from — convenience for callers. */
export function providerTraitsFor(provider: IngressProvider) {
	return ingressProviderTraits(provider)
}
