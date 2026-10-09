/**
 * Join entry points — the routes a NOT-YET-MEMBER can use to reach this cluster.
 *
 * Joining differs from reachability. `ingressExposure` answers "who can reach the
 * RUNNING stack"; this answers the chicken-and-egg question that comes BEFORE it:
 * a node that has no mesh address, no WireGuard key and no swarm membership yet
 * must still be able to reach an API to be admitted at all.
 *
 * A joining node has almost nothing: it can dial a DNS name or an address, from an
 * empty machine. So there are exactly two kinds of path:
 *
 *   lan      an existing member and the joiner share a subnet; the member's     no provider,
 *            private door also binds its LAN address                            no public IP
 *   public   the joiner dials the public lane's hostname, carried by whatever   per edge
 *            edge provider serves it (a tunnel, inbound ports, …)              provider
 *
 * The public path is described by the ACTIVE edge provider (`PublicJoinPath`),
 * because only it knows whether its edge can carry a stranger in — this module
 * stays provider-agnostic.
 *
 * There is deliberately NO `mesh` entry: reaching a node over the mesh REQUIRES
 * being a member, which is the thing being established.
 *
 * Pure: describes what the configuration permits, never probes.
 */

import z from 'zod/v4'

import type { IngressLanes } from './lanes.schema'

/** Least setup / least exposure first — `INGRESS_JOIN_ENTRY_POINTS` is that order. */
export const joinEntryPointKindSchema = z.enum(['lan', 'public'])
export type JoinEntryPointKind = z.output<typeof joinEntryPointKindSchema>

export const INGRESS_JOIN_ENTRY_POINTS = ['lan', 'public'] as const

export const joinEntryPointSchema = z.object({
	kind: joinEntryPointKindSchema,
	/** Human name of the path ("Same network", or the edge provider's label). */
	via: z.string(),
	/** Whether this cluster can be joined through it right now. */
	available: z.boolean(),
	/** What the joining node dials. Null when nothing is configured. */
	target: z.string().nullable(),
	/**
	 * The `Host` that must be sent when the dialed address is not itself a name
	 * Traefik has a router for (Traefik matches on `Host(...)`). Null when the
	 * target already is the route's hostname.
	 */
	hostHeader: z.string().nullable(),
	/** How many existing members offer this path — the redundancy behind it. */
	sources: z.number().int().min(0),
	/** Why it is unavailable, or what it costs. Always shown, never inferred by the client. */
	detail: z.string(),
})
export type JoinEntryPoint = z.output<typeof joinEntryPointSchema>

export const joinEntryPointSummarySchema = z.object({
	/** True when at least one path exists — i.e. a fresh node can actually join. */
	joinable: z.boolean(),
	/** The path an operator should try first, or null when nothing is available. */
	preferred: joinEntryPointKindSchema.nullable(),
	points: z.array(joinEntryPointSchema),
})
export type JoinEntryPointSummary = z.output<typeof joinEntryPointSummarySchema>

/** What the active edge provider says about joining through the public lane. */
export interface PublicJoinPath {
	/** The provider's label, e.g. "Cloudflare Tunnel". */
	via: string
	available: boolean
	target: string | null
	hostHeader: string | null
	sources: number
	detail: string
}

export interface JoinEntryPointInputs {
	lanes: IngressLanes
	/** Existing members that are active and are NODES (an operator laptop serves no entry). */
	memberCount: number
	/** The active edge provider's answer, or null when there is no public lane. */
	publicPath: PublicJoinPath | null
}

/** The public hostname the console answers on, when a public lane exists. */
export function publicEntryHost(lanes: IngressLanes): string | null {
	return lanes.public === null ? null : `web.${lanes.public.domain}`
}

const NO_MEMBERS = 'This cluster has no members yet, so there is nothing to join — this node is the first one.'

/**
 * Rank the ways a new node can join, and say what each one requires.
 *
 * `available` is a statement about CONFIGURATION, not about liveness; every point
 * carries a `sources` count so an operator can notice when the one member behind
 * a path is down.
 */
export function joinEntryPoints(inputs: JoinEntryPointInputs): JoinEntryPointSummary {
	const { lanes, memberCount, publicPath } = inputs
	const lanOpen = lanes.private.enabled && lanes.private.exposeOnLan
	const members = Math.max(0, memberCount)
	const entryable = members > 0

	const lan: JoinEntryPoint = {
		kind: 'lan',
		via: 'Same network',
		available: entryable && lanOpen,
		target: entryable && lanOpen ? `http://<member LAN address>:${String(lanes.entryPort)}` : null,
		hostHeader: `api.${lanes.private.domain}`,
		sources: entryable && lanOpen ? members : 0,
		detail: !entryable
			? NO_MEMBERS
			: !lanes.private.enabled
				? 'The private lane is off, so no member binds its LAN address. Turn the private lane on to join from the same network.'
				: !lanOpen
					? `The private lane is on but binds the mesh address only. Enable "allow same-network join" so a node that is not yet a member can reach :${String(lanes.entryPort)}.`
					: `A node on the same subnet dials any member on :${String(lanes.entryPort)}, sending Host: api.${lanes.private.domain} — Traefik matches on the hostname, so the address alone is not enough. No public IP, no DNS, no provider account.`,
	}

	const pub: JoinEntryPoint =
		publicPath === null
			? {
					kind: 'public',
					via: 'Public lane',
					available: false,
					target: null,
					hostHeader: null,
					sources: 0,
					detail: entryable
						? 'No public lane is enabled. Turn one on to let a node join from anywhere.'
						: NO_MEMBERS,
				}
			: {
					kind: 'public',
					via: publicPath.via,
					available: entryable && publicPath.available,
					target: entryable ? publicPath.target : null,
					hostHeader: publicPath.hostHeader,
					sources: entryable ? publicPath.sources : 0,
					detail: entryable ? publicPath.detail : NO_MEMBERS,
				}

	const points = [lan, pub]
	// First AVAILABLE in canonical order — the caller does not re-derive the ranking.
	const preferred = points.find((point) => point.available)?.kind ?? null
	return { joinable: preferred !== null, preferred, points }
}
