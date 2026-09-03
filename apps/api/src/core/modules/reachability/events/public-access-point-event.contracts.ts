/**
 * Public Access Point — event contracts (global relay via the core event
 * system). Every change to the node's public access point is emitted as a
 * discriminated-union event, so any feature can watch the exact same state.
 */
import * as z from "zod/v4";
import { contractBuilder } from "@repo/nest-events";

/** Base fields shared by every access-point state (kind is the discriminator). */
const accessPointBaseSchema = z.object({
    configured: z.boolean(),
    address: z.string().nullable(),
    publicUrl: z.string().nullable(),
    providerId: z.string().nullable(),
    tunnelEnabled: z.boolean(),
    reachable: z.boolean().nullable(),
    lastCheckedAt: z.string().nullable(),
    latencyMs: z.number().nullable(),
    statusCode: z.number().nullable(),
    error: z.string().nullable(),
});

/**
 * Discriminated union of access-point states. `kind` discriminates:
 *   - ip       → the access point is a public IP
 *   - hostname → the access point is a hostname
 *   - tunnel   → the access point is a DNS-provider-backed tunnel
 *   - null     → nothing is configured
 */
export const publicAccessPointEventSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ip"), ...accessPointBaseSchema.shape }),
    z.object({ kind: z.literal("hostname"), ...accessPointBaseSchema.shape }),
    z.object({ kind: z.literal("tunnel"), ...accessPointBaseSchema.shape }),
    z.object({ kind: z.null(), ...accessPointBaseSchema.shape }),
]);

/** The discriminated-union input (event parameters) for the access-point stream. */
const accessPointEventInputSchema = z.object({
    // Namespacing key — every event with the same key shares one stream.
    scope: z.string().default("node"),
});

export const publicAccessPointEventContracts = {
    /**
     * Emitted whenever the node's public access point is (re)checked and its
     * state changes/refreshes. Input scopes the stream; output is the full
     * discriminated-union state.
     */
    accessPointUpdated: contractBuilder()
        .input(accessPointEventInputSchema)
        .output(publicAccessPointEventSchema)
        .build(),
} as const;

export type PublicAccessPointEventContracts = typeof publicAccessPointEventContracts;
export type PublicAccessPointEvent = z.infer<typeof publicAccessPointEventSchema>;
