import z from "zod/v4";

/**
 * Network Configuration — provider-backed networking for projects & services.
 *
 * Replaces the legacy free-text `baseDomain` (project) and `customDomains[]`
 * (service) with a **DNS-provider-aware** model:
 *
 * - A project picks a DNS provider account (e.g. Cloudflare) + one of its
 *   existing zones. The zone name BECOMES the project's base domain.
 * - Services inherit the project's provider/zone unless overridden, and can
 *   auto-provision DNS records (A/CNAME) for their bindings via the provider.
 * - `autoProvisionRecords` creates the DNS record in the provider zone at
 *   service-bind time (no manual DNS editing).
 */

/** DNS record types we can provision through a provider. */
export const networkDnsRecordTypeSchema = z.enum(["A", "AAAA", "CNAME", "TXT"]);
export type NetworkDnsRecordType = z.infer<typeof networkDnsRecordTypeSchema>;
export const NETWORK_DNS_RECORD_TYPES = [...networkDnsRecordTypeSchema.options] as readonly NetworkDnsRecordType[];

/** TLS policy applied at the edge (ingress / proxy). */
export const networkTlsSchema = z
    .object({
        enabled: z.boolean().default(false),
        /** Redirect plain HTTP → HTTPS. */
        httpRedirect: z.boolean().default(true),
    })
    .default({ enabled: false, httpRedirect: true });
export type NetworkTls = z.infer<typeof networkTlsSchema>;

/**
 * PROJECT-level network configuration.
 *
 * The project anchors networking to ONE DNS provider account + ONE zone.
 * The zone name is the authoritative base domain; `baseDomain` on the project
 * row is derived from it (kept in sync by the API).
 */
export const projectNetworkConfigSchema = z
    .object({
        /** DNS provider account row id (dns_providers.id). Null = not configured. */
        dnsProviderId: z.string().nullable().default(null),
        /** Zone id inside the provider (Cloudflare zone id). */
        zoneId: z.string().nullable().default(null),
        /** Zone name — the project's base domain (e.g. "example.com"). */
        zoneName: z.string().nullable().default(null),
        /** Auto-create DNS records when a service binding is saved. */
        autoProvisionRecords: z.boolean().default(false),
        /** Default Cloudflare "proxied" (orange-cloud) for new records. */
        proxiedDefault: z.boolean().default(true),
        /** Allow wildcard subdomains (e.g. `*.preview.example.com`). */
        wildcardSubdomains: z.boolean().default(false),
        /** Record type used when auto-provisioning service bindings. */
        recordType: networkDnsRecordTypeSchema.default("CNAME"),
        /** Target content for provisioned records (e.g. LB hostname). */
        recordContent: z.string().nullable().default(null),
    })
    .strict();
export type ProjectNetworkConfig = z.infer<typeof projectNetworkConfigSchema>;

/** Full defaults — used when a project has no network config yet. */
export const defaultProjectNetworkConfig = (): ProjectNetworkConfig =>
    projectNetworkConfigSchema.parse({});

/**
 * SERVICE-level network configuration.
 *
 * All fields nullable/optional so a service can INHERIT the project's provider
 * + zone. Only fields explicitly set here override the project config.
 */
export const serviceNetworkConfigSchema = z
    .object({
        /** Override the project's provider account. Null = inherit project. */
        dnsProviderId: z.string().nullable().default(null),
        /** Override the project's zone. Null = inherit project. */
        zoneId: z.string().nullable().default(null),
        /** Zone name (read-model, kept in sync). */
        zoneName: z.string().nullable().default(null),
        /** Record type for this service's provisioned records. */
        recordType: networkDnsRecordTypeSchema.default("CNAME"),
        /** Target content for this service's records. */
        recordContent: z.string().nullable().default(null),
        /** Proxy through the provider (Cloudflare orange-cloud). */
        proxied: z.boolean().default(true),
        /** Auto-provision the DNS record for this service on bind. */
        autoProvision: z.boolean().default(false),
        /** Route this service through the ingress (Traefik). */
        expose: z.boolean().default(false),
        /** Edge TLS policy. */
        tls: networkTlsSchema,
    })
    .strict();
export type ServiceNetworkConfig = z.infer<typeof serviceNetworkConfigSchema>;

/** Full defaults for a fresh service network config. */
export const defaultServiceNetworkConfig = (): ServiceNetworkConfig =>
    serviceNetworkConfigSchema.parse({});
