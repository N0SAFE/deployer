/**
 * DNS Provider Entity Schemas — SSOT for DNS provider shapes.
 *
 * Used by the providers module (registry + adapters) AND the API contracts.
 * Strong typing: provider type + record type are enums, zones/records are
 * validated shapes, no loose strings.
 */
import z from "zod/v4";
import {
    dnsProviderTypeSchema,
    dnsRecordTypeSchema,
} from "@repo/contracts-common";

/** Account reference used to pin a specific provider account in dispatch. */
export const dnsProviderAccountRefSchema = z.object({
    /** Account row id (github_apps row id until the P0 storage fix). */
    providerId: z.string().min(1),
    /** Provider type used for dispatch: "cloudflare" | "route53" | ... */
    providerType: dnsProviderTypeSchema,
});
export type DnsProviderAccountRef = z.infer<typeof dnsProviderAccountRefSchema>;

/** A DNS zone managed by a provider account. */
export const dnsProviderZoneSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    status: z.string(),
    nameServers: z.array(z.string()),
});
export type DnsProviderZone = z.infer<typeof dnsProviderZoneSchema>;

/** A DNS record inside a zone. */
export const dnsProviderRecordSchema = z.object({
    id: z.string().min(1),
    zoneId: z.string().min(1),
    name: z.string().min(1),
    type: dnsRecordTypeSchema,
    content: z.string().min(1),
    ttl: z.number().int().nonnegative(),
    proxied: z.boolean(),
});
export type DnsProviderRecord = z.infer<typeof dnsProviderRecordSchema>;

/** Input for creating a DNS record. */
export const createDnsRecordInputSchema = z
    .object({
        zoneId: z.string().min(1),
        type: dnsRecordTypeSchema,
        name: z.string().min(1),
        content: z.string().min(1),
        ttl: z.number().int().nonnegative().optional(),
        proxied: z.boolean().optional(),
    })
    .strict();
export type CreateDnsRecordInput = z.infer<typeof createDnsRecordInputSchema>;

/** Provider account row shape (public view, never exposes the token). */
export const dnsProviderAccountSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    providerType: dnsProviderTypeSchema,
    isActive: z.boolean(),
    hasToken: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});
export type DnsProviderAccount = z.infer<typeof dnsProviderAccountSchema>;
