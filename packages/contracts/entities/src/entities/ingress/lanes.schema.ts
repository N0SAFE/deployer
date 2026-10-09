/**
 * @fileoverview Ingress lanes — the ways a client can reach the stack's Traefik,
 * and which of them a route is attached to.
 *
 * ── WHY LANES, NOT A MODE ───────────────────────────────────────────────────
 * The platform used to model reachability as ONE stack-wide mode
 * (`local | wireguard | tunnel | direct`). A mode cannot say "reachable from this
 * machine AND from the private mesh AND publicly through the tunnel", and it
 * cannot say "this app is internal, that one is public". Both are ordinary needs:
 * an operator's dashboard on the mesh, customer apps through the tunnel, and
 * `*.deployer.localhost` working on the machine itself no matter what.
 *
 * So reachability is a set of LANES that can be on at the same time, each a
 * separate Traefik entrypoint with its own door:
 *
 *   local    always on   loopback door on every node         *.deployer.localhost
 *   private  opt-in      door on each node's mesh address    *.<private domain>
 *   public   opt-in      ONE edge provider:                  *.<public domain>
 *                          (see `edge-providers.schema.ts` — a tunnel that dials
 *                          out, or inbound ports the operator acknowledges)
 *
 * and every route has a VISIBILITY that picks its lanes:
 *
 *   private  → local + private
 *   public   → local + private + public
 *
 * Nothing here reads env or the database: it describes lanes, not this install.
 */

import z from 'zod/v4'

import { edgeOptionsSchema, edgeProviderIdSchema, type EdgeProviderDescriptor } from './edge-providers.schema'

export const ingressLaneSchema = z.enum(['local', 'private', 'public'])
export type IngressLane = z.output<typeof ingressLaneSchema>

/** Every lane, least-exposed first. Anything that ranks lanes reads this order. */
export const INGRESS_LANES = ['local', 'private', 'public'] as const

export const routeVisibilitySchema = z.enum(['private', 'public'])
export type RouteVisibility = z.output<typeof routeVisibilitySchema>

/**
 * Default private domain. `.internal` is reserved by ICANN for private use, so it
 * can never collide with a real public name.
 */
export const DEFAULT_PRIVATE_DOMAIN = 'deployer.internal'

/** Host port every door binds when nothing else is configured. */
export const DEFAULT_ENTRY_PORT = 80

const domainSchema = z
	.string()
	.min(3)
	.max(253)
	.regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'must be a lowercase domain such as apps.example.com')

/**
 * The public lane: which edge provider carries it, for which domain.
 *
 * `provider` names a registered edge provider and `options` are ITS options,
 * validated by that provider in the API — the lane itself stays provider-agnostic
 * so a new provider needs no schema change here.
 */
export const publicLaneSchema = z.object({
	provider: edgeProviderIdSchema,
	/** Apps are published as `<label>.<domain>`; the edge routes `*.<domain>`. */
	domain: domainSchema,
	/**
	 * The operator's statement that nodes may open inbound ports. Required (true)
	 * by every provider whose descriptor says `opensInboundPorts` — a decision the
	 * operator states, never a default a client gets by omission.
	 */
	acknowledgedInboundPorts: z.boolean(),
	options: edgeOptionsSchema,
})
export type PublicLane = z.output<typeof publicLaneSchema>

/** The stack's lanes. A cluster-wide setting, replicated by the mesh. */
export const ingressLanesSchema = z.object({
	/** Host port the node doors bind (local, LAN and private lanes). */
	entryPort: z.number().int().min(1).max(65_535),
	private: z.object({
		enabled: z.boolean(),
		domain: domainSchema,
		/**
		 * Also bind the private lane on the node's LAN address.
		 *
		 * This is the only entry point a node can use BEFORE it is in the mesh: the
		 * private door binds the mesh address, which a joiner does not have yet, and
		 * the local door binds loopback. Defaults to `false` — same-scope peers are
		 * still other machines, so opening the subnet is the operator's call.
		 *
		 * `.default(false)` so a lanes setting written before this field existed
		 * still parses instead of silently falling back to local-only.
		 */
		exposeOnLan: z.boolean().default(false),
	}),
	/** Null = no public lane: nothing about this stack is on the internet. */
	public: publicLaneSchema.nullable(),
	/**
	 * Visibility of the platform's own console (api, web, setup).
	 *
	 * `public` by default so webhooks and OAuth callbacks keep working once a public
	 * lane exists; an operator who wants the console mesh-only sets `private`.
	 */
	consoleVisibility: routeVisibilitySchema,
})
export type IngressLanes = z.output<typeof ingressLanesSchema>

/**
 * The lanes of a fresh install: local only.
 *
 * Local is the one lane that cannot expose the machine — a door on loopback — so
 * a brand-new node is reachable from itself and from nowhere else until the
 * operator opens something wider.
 */
export function defaultIngressLanes(entryPort: number = DEFAULT_ENTRY_PORT): IngressLanes {
	return {
		entryPort,
		private: { enabled: false, domain: DEFAULT_PRIVATE_DOMAIN, exposeOnLan: false },
		public: null,
		consoleVisibility: 'public',
	}
}

/** The lanes currently enabled, least-exposed first. `local` is always among them. */
export function enabledLanes(lanes: IngressLanes): IngressLane[] {
	return INGRESS_LANES.filter(
		(lane) => lane === 'local' || (lane === 'private' && lanes.private.enabled) || (lane === 'public' && lanes.public !== null),
	)
}

/** The enabled lanes a route of `visibility` is attached to. */
export function lanesForVisibility(visibility: RouteVisibility, lanes: IngressLanes): IngressLane[] {
	return enabledLanes(lanes).filter((lane) => lane !== 'public' || visibility === 'public')
}

/**
 * How exposed the stack is, as plain answers derived from the lanes.
 *
 * Kept as one function so the API, the UI and the supervisors cannot disagree:
 * `private` binds a non-loopback address but only on the mesh, which is not the
 * internet; a tunnel edge reaches the internet without binding anything.
 */
export interface IngressExposure {
	/** Some client on another machine can reach the stack. */
	reachableOffMachine: boolean
	/** Some client on the public internet can reach the stack. */
	reachableFromInternet: boolean
	/** A node opens an inbound port on a public interface (an `inbound` edge). */
	opensInboundPorts: boolean
	/** A third-party account is involved (e.g. a tunnel provider). */
	usesProviderAccount: boolean
	/** A node binds its LAN address, so a same-network peer can join before it is a member. */
	reachableOnLan: boolean
}

/**
 * `publicEdge` is the descriptor of the provider behind the public lane (null when
 * there is no public lane, or its provider is not registered on this API).
 */
export function ingressExposure(lanes: IngressLanes, publicEdge: EdgeProviderDescriptor | null): IngressExposure {
	const hasPublic = lanes.public !== null
	return {
		reachableOffMachine: lanes.private.enabled || hasPublic,
		reachableFromInternet: hasPublic,
		opensInboundPorts: hasPublic && (publicEdge?.opensInboundPorts ?? false),
		usesProviderAccount: hasPublic && (publicEdge?.usesProviderAccount ?? false),
		reachableOnLan: lanes.private.enabled && lanes.private.exposeOnLan,
	}
}
