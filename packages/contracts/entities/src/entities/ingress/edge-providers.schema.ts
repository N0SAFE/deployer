/**
 * @fileoverview Edge providers — the pluggable ways the PUBLIC lane reaches Traefik.
 *
 * ── LAYERS ──────────────────────────────────────────────────────────────────
 * Reachability is built from independent layers, each with its own extension
 * point, so adding a solution never means editing the others:
 *
 *   network   the mesh (WireGuard between members)          mesh agent
 *   ingress   Traefik + lanes (local / private / public)    lanes setting
 *   edge      how the PUBLIC lane reaches Traefik           EDGE PROVIDERS  ← this file
 *   dns       where a name points                           DNS providers
 *
 * An edge provider is a plugin the API registers (Cloudflare Tunnel, direct
 * inbound ports, …). It describes itself with an `EdgeProviderDescriptor` — the
 * catalog the web renders its choices and forms from — so a new provider shows up
 * in the UI without a UI change.
 *
 * ── KINDS ───────────────────────────────────────────────────────────────────
 *   tunnel    connectors on the cluster dial OUT to the provider; no node opens a
 *             port and no node needs a public address
 *   inbound   clients connect straight to the nodes; nodes open ports, which the
 *             operator must acknowledge (`acknowledgedInboundPorts`)
 *
 * Nothing here knows any concrete provider: providers live in the API.
 */

import z from 'zod/v4'

export const edgeProviderKindSchema = z.enum(['tunnel', 'inbound'])
export type EdgeProviderKind = z.output<typeof edgeProviderKindSchema>

/** A provider id: stable, lowercase, used as the lane's `provider` and as a settings key. */
export const edgeProviderIdSchema = z
	.string()
	.min(2)
	.max(40)
	.regex(/^[a-z][a-z0-9-]*$/, 'must be a lowercase id such as cloudflare-tunnel')

/** Option values a public lane may carry — primitives only, so they replicate as plain JSON. */
export const edgeOptionValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type EdgeOptionValue = z.output<typeof edgeOptionValueSchema>
export const edgeOptionsSchema = z.record(z.string(), edgeOptionValueSchema)
export type EdgeOptions = z.output<typeof edgeOptionsSchema>

const fieldBase = {
	key: z.string().min(1),
	label: z.string(),
	description: z.string().nullable(),
}

/**
 * One option a provider needs, described well enough for a generic form.
 *
 * `dns-account` asks for an account configured under the DNS providers (the
 * account a tunnel is created on); `requiredFeature` narrows it to accounts with
 * that feature enabled.
 */
export const edgeOptionFieldSchema = z.discriminatedUnion('type', [
	z.object({ ...fieldBase, type: z.literal('boolean'), defaultValue: z.boolean() }),
	z.object({
		...fieldBase,
		type: z.literal('text'),
		required: z.boolean(),
		placeholder: z.string().nullable(),
	}),
	z.object({
		...fieldBase,
		type: z.literal('dns-account'),
		required: z.boolean(),
		providerType: z.string(),
		requiredFeature: z.string().nullable(),
	}),
])
export type EdgeOptionField = z.output<typeof edgeOptionFieldSchema>

export const edgeProviderDescriptorSchema = z.object({
	id: edgeProviderIdSchema,
	label: z.string(),
	kind: edgeProviderKindSchema,
	/** One line for a picker. */
	summary: z.string(),
	/** What it does and what it costs, for the detail view. */
	description: z.string(),
	/** Nodes open inbound ports. Requires the lane's explicit acknowledgement. */
	opensInboundPorts: z.boolean(),
	/** A third-party account is involved. */
	usesProviderAccount: z.boolean(),
	/** Public routes are served over HTTPS (by the edge or by ACME on the nodes). */
	servesHttps: z.boolean(),
	options: z.array(edgeOptionFieldSchema),
})
export type EdgeProviderDescriptor = z.output<typeof edgeProviderDescriptorSchema>

/** One fact a provider reports about its edge (tunnel id, connections, addresses…). */
export const edgeFactSchema = z.object({ label: z.string(), value: z.string() })
export type EdgeFact = z.output<typeof edgeFactSchema>

export const edgeHealthSchema = z.enum(['healthy', 'degraded', 'down', 'unknown'])
export type EdgeHealth = z.output<typeof edgeHealthSchema>

/**
 * Something the edge owns on its provider (a tunnel, a relay host…), so pages
 * about that provider can mark "this one is the stack's" without knowing the edge.
 */
export const edgeResourceSchema = z.object({
	/** Provider-specific kind, e.g. `tunnel`. */
	kind: z.string(),
	id: z.string(),
	/** The DNS-provider account it lives on, when it lives on one. */
	accountId: z.string().nullable(),
})
export type EdgeResource = z.output<typeof edgeResourceSchema>

/** The live state of the active public edge, as its provider reports it. */
export const edgeStatusSchema = z.object({
	/** The provider side exists (tunnel created, addresses declared…). */
	provisioned: z.boolean(),
	health: edgeHealthSchema,
	/** What is wrong, or what the operator still has to do. */
	detail: z.string().nullable(),
	facts: z.array(edgeFactSchema),
	resources: z.array(edgeResourceSchema),
})
export type EdgeStatus = z.output<typeof edgeStatusSchema>
