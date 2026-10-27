import z from "zod/v4";

/**
 * One service's contribution to the platform roll-up.
 *
 * `latencyMs` is absent when the service did not answer at all — which is what
 * distinguishes "unreachable" from "answered with a failure", and the two need
 * different operator responses.
 */
export const serviceHealthSchema = z.object({
	name: z.string(),
	healthy: z.boolean(),
	url: z.string(),
	/** Why it is unhealthy, when it is. One line the operator can act on. */
	reason: z.string().optional(),
	/** Round trip of the probe, when it answered. */
	latencyMs: z.number().optional(),
});

/**
 * The platform verdict.
 *
 * Deliberately three states rather than a boolean: "every service answered but one
 * is not ready" and "no service answered at all" need different operator responses —
 * the first is a restart, the second is a network or boot problem — and collapsing
 * them loses the distinction at the one moment it matters.
 */
export const platformHealthSchema = z.object({
	state: z.enum(["healthy", "degraded", "unreachable"]),
	services: z.array(serviceHealthSchema),
	checkedAt: z.string(),
});

export type ServiceHealth = z.output<typeof serviceHealthSchema>;
export type PlatformHealth = z.output<typeof platformHealthSchema>;
