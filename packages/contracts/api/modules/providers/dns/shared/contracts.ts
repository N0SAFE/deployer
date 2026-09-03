/**
 * Shared DNS Provider Contracts
 *
 * Provider-agnostic DNS provider app CRUD + runtime state. Shared across
 * all DNS provider variants (cloudflare, route53, google-dns, ...).
 * Exposed as `orpc.providers.dns.<op>`.
 */
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

// ─── DNS Provider App Schemas ────────────────────────────────────────────

/**
 * Feature flags a DNS provider app exposes. Other modules gate their UI and
 * behavior on these: a feature only "exists" when at least one provider app
 * has it enabled AND its runtime state is healthy.
 */
export const dnsProviderFeaturesSchema = z.object({
    dnsManagement: z.boolean().default(true),
    tunnelManagement: z.boolean().default(false),
});

/**
 * Runtime state of a provider app — always re-checked live at request time
 * (with a short server-side TTL), never authoritative from the DB alone.
 */
export const dnsProviderRuntimeStateSchema = z.object({
    status: z.enum(["ok", "error", "unknown"]),
    checkedAt: z.string().nullable(),
    accountId: z.string().nullable(),
    tokenValid: z.boolean().nullable(),
    error: z.string().nullable(),
});

export const dnsProviderSchema = z.object({
    id: z.string(),
    name: z.string(),
    providerType: z.string(),
    isActive: z.boolean(),
    features: dnsProviderFeaturesSchema,
    state: dnsProviderRuntimeStateSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

export const createDnsProviderInputSchema = z.object({
    name: z.string().min(1, "Name is required"),
    providerType: z.enum(["cloudflare", "route53", "google-dns", "digitalocean", "other"]),
    apiToken: z.string().min(1, "API token is required"),
    accountEmail: z.string().email().optional(),
    features: dnsProviderFeaturesSchema.partial().optional(),
});

export const updateDnsProviderInputSchema = z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    features: dnsProviderFeaturesSchema.partial().optional(),
});

const dnsProviderListOutputSchema = z.object({
    providers: z.array(dnsProviderSchema),
    total: z.number(),
});

// ─── Contract Builders ────────────────────────────────────────────────────

const dnsProviderOps = standard.zod(dnsProviderSchema, "dnsProvider");

// ─── DNS Provider CRUD Contracts ─────────────────────────────────────────

export const dnsProviderListContract = dnsProviderOps
    .list()
    .path("/dns/providers")
    .input(z.object({}))
    .output(dnsProviderListOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const dnsProviderCreateContract = dnsProviderOps
    .create()
    .path("/dns/providers")
    .input((b) => b.body(createDnsProviderInputSchema))
    .output(dnsProviderSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const dnsProviderUpdateContract = dnsProviderOps
    .update()
    .input((b) => b
        .params((p) => p`/dns/providers/${p("id", z.string())}`)
        .body(updateDnsProviderInputSchema),
    )
    .output(dnsProviderSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const dnsProviderDeleteContract = dnsProviderOps
    .delete()
    .input((b) => b.params((p) => p`/dns/providers/${p("id", z.string())}`))
    .output(z.object({ success: z.boolean() }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Force a live runtime re-check of a provider app's state. */
export const dnsProviderCheckStateContract = dnsProviderOps
    .read()
    .input((b) => b.params((p) => p`/dns/providers/${p("id", z.string())}/state`))
    .output(dnsProviderRuntimeStateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Aggregated Contracts ─────────────────────────────────────────────────

export const dnsProviderAppContract = {
    list: dnsProviderListContract,
    create: dnsProviderCreateContract,
    update: dnsProviderUpdateContract,
    delete: dnsProviderDeleteContract,
    checkState: dnsProviderCheckStateContract,
};

export type DnsProviderAppContract = typeof dnsProviderAppContract;
