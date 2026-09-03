/**
 * Cloudflare DNS Provider Contracts
 *
 * Cloudflare-specific endpoints: zones, DNS records, and tunnels. Exposed
 * as `orpc.providers.dns.cloudflare.*`.
 */
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import z from "zod/v4";

// ─── Cloudflare Tunnel Schemas ───────────────────────────────────────────

export const cloudflareTunnelConnectionSchema = z.object({
    id: z.string().nullable(),
    clientId: z.string().nullable(),
    coloName: z.string().nullable(),
    clientVersion: z.string().nullable(),
    isPendingReconnect: z.boolean().nullable(),
    openedAt: z.string().nullable(),
    originIp: z.string().nullable(),
});

export const cloudflareTunnelSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    status: z.enum(["inactive", "degraded", "healthy", "down"]).nullable(),
    tunType: z.string().nullable(),
    createdAt: z.string().nullable(),
    connections: z.array(cloudflareTunnelConnectionSchema).default([]),
});

const cloudflareTunnelListOutputSchema = z.object({
    tunnels: z.array(cloudflareTunnelSchema),
    error: z.string().nullable().optional(),
});

const cloudflareTunnelDetailOutputSchema = z.object({
    tunnel: cloudflareTunnelSchema.nullable(),
    error: z.string().nullable().optional(),
});

/** Token used by `cloudflared` to run a tunnel (credentials JSON). */
const cloudflareTunnelTokenOutputSchema = z.object({
    token: z.string().nullable(),
    error: z.string().nullable().optional(),
});

const cloudflareCreateTunnelInputSchema = z.object({
    name: z.string().min(1, "Tunnel name is required"),
    /** Optional public hostname to route through the tunnel (auto CNAME). */
    hostname: z.string().min(1).optional(),
});

const cloudflareCreateTunnelOutputSchema = z.object({
    tunnel: cloudflareTunnelSchema,
    token: z.string(),
    /** DNS record created for `hostname` (CNAME → tunnel), when requested. */
    dnsRecord: z.string().nullable(),
    hostname: z.string().nullable(),
    error: z.string().nullable().optional(),
});

// ─── Cloudflare Zone/Record Schemas ──────────────────────────────────────

export const cloudflareZoneSchema = z.object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    nameServers: z.array(z.string()).optional(),
});

const cloudflareZoneListOutputSchema = z.object({
    zones: z.array(cloudflareZoneSchema),
    error: z.string().nullable().optional(),
});

export const cloudflareDnsRecordSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    content: z.string(),
    ttl: z.number(),
    proxied: z.boolean().optional(),
});

export const cloudflareDnsRecordTypes = [
    "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC",
    "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB",
    "TLSA", "TXT", "URI",
] as const;

const cloudflareDnsRecordListInputSchema = z.object({
    type: z.enum(cloudflareDnsRecordTypes).optional(),
    name: z.string().optional(),
    // z.coerce.number(): ORPC standard REST sends query params as strings
    // ("1"), and pluggable coercion does not always apply to query decoding —
    // without coerce, any `page`/`pageSize` query returns 400.
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

const cloudflareDnsRecordListOutputSchema = z.object({
    records: z.array(cloudflareDnsRecordSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    error: z.string().nullable().optional(),
});

const cloudflareDnsRecordCheckInputSchema = z.object({
    zoneId: z.string().min(1),
    recordName: z.string().min(1),
    recordType: z.enum(cloudflareDnsRecordTypes).optional(),
    /** When provided, `matchContent` reports whether a record's content equals it (trailing-dot + case insensitive). */
    recordContent: z.string().min(1).optional(),
});

const cloudflareDnsRecordCheckOutputSchema = z.object({
    exists: z.boolean(),
    records: z.array(cloudflareDnsRecordSchema),
    matchContent: z.boolean().nullable(),
    error: z.string().nullable().optional(),
});

const cloudflareDnsRecordCreateInputSchema = z.object({
    type: z.enum(["A", "AAAA", "CNAME", "TXT"]),
    name: z.string().min(1),
    content: z.string().min(1),
    ttl: z.number().int().positive().optional(),
    proxied: z.boolean().optional(),
});

// ─── Contract Builders ────────────────────────────────────────────────────

const cloudflareTunnelOps = standard.zod(cloudflareTunnelSchema, "cloudflareTunnel");
const cloudflareZoneOps = standard.zod(cloudflareZoneSchema, "cloudflareZone");
const cloudflareRecordOps = standard.zod(cloudflareDnsRecordSchema, "cloudflareDnsRecord");
const cloudflareRecordCheckOps = standard.zod(cloudflareDnsRecordCheckOutputSchema, "cloudflareRecordCheck");

// ─── Cloudflare Zone & Record Contracts ──────────────────────────────────

export const cloudflareListZonesContract = cloudflareZoneOps
    .list()
    .input((b) => b.params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/zones`))
    .output(cloudflareZoneListOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareListRecordsContract = cloudflareRecordOps
    .list()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/zones/${p("zoneId", z.string())}/records`)
        .query(cloudflareDnsRecordListInputSchema),
    )
    .output(cloudflareDnsRecordListOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareCheckRecordContract = cloudflareRecordCheckOps
    .list()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/zones/${p("zoneId", z.string())}/check`)
        .query(z.object({ recordName: z.string(), recordType: z.enum(cloudflareDnsRecordTypes).optional(), recordContent: z.string().min(1).optional() })),
    )
    .output(cloudflareDnsRecordCheckOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareCreateRecordContract = cloudflareRecordOps
    .create()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/zones/${p("zoneId", z.string())}/records`)
        .body(cloudflareDnsRecordCreateInputSchema),
    )
    .output(cloudflareDnsRecordSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareDeleteRecordContract = cloudflareRecordOps
    .delete()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/zones/${p("zoneId", z.string())}/records/${p("id", z.string())}`),
    )
    .output(z.object({ success: z.boolean() }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Cloudflare Tunnel Contracts ─────────────────────────────────────────

export const cloudflareListTunnelsContract = cloudflareTunnelOps
    .list()
    .input((b) => b.params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/tunnels`))
    .output(cloudflareTunnelListOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareGetTunnelContract = cloudflareTunnelOps
    .read()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/tunnels/${p("id", z.string())}`),
    )
    .output(cloudflareTunnelDetailOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Auto-setup: create the tunnel, fetch its run token, optional CNAME. */
export const cloudflareCreateTunnelContract = cloudflareTunnelOps
    .create()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/tunnels`)
        .body(cloudflareCreateTunnelInputSchema),
    )
    .output(cloudflareCreateTunnelOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export const cloudflareDeleteTunnelContract = cloudflareTunnelOps
    .delete()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/tunnels/${p("id", z.string())}`),
    )
    .output(z.object({ success: z.boolean() }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Token used by `cloudflared` to run a tunnel (for setup instructions). */
export const cloudflareGetTunnelTokenContract = cloudflareTunnelOps
    .read()
    .input((b) => b
        .params((p) => p`/dns/cloudflare/${p("providerId", z.string())}/tunnels/${p("id", z.string())}/token`),
    )
    .output(cloudflareTunnelTokenOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

// ─── Aggregated Contracts ─────────────────────────────────────────────────

export const cloudflareProviderContract = {
    listZones: cloudflareListZonesContract,
    listRecords: cloudflareListRecordsContract,
    checkRecord: cloudflareCheckRecordContract,
    createRecord: cloudflareCreateRecordContract,
    deleteRecord: cloudflareDeleteRecordContract,
    listTunnels: cloudflareListTunnelsContract,
    getTunnel: cloudflareGetTunnelContract,
    createTunnel: cloudflareCreateTunnelContract,
    deleteTunnel: cloudflareDeleteTunnelContract,
    getTunnelToken: cloudflareGetTunnelTokenContract,
};

export type CloudflareProviderContract = typeof cloudflareProviderContract;
