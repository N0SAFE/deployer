import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceNetworkConfigSchema } from "@repo/contracts-entities";

/** Service network read model — config + resolved project context + zone records. */
export const serviceNetworkViewSchema = z.object({
    network: serviceNetworkConfigSchema.nullable(),
    /** Resolved provider account (service override → project network). */
    dnsProviderId: z.string().nullable(),
    /** Resolved zone (service override → project network). */
    zoneId: z.string().nullable(),
    zoneName: z.string().nullable(),
    /** Zone records from the resolved provider/zone (live). */
    records: z.array(
        z.object({
            id: z.string(),
            zoneId: z.string(),
            name: z.string(),
            type: z.enum(["A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI"]),
            content: z.string(),
            ttl: z.number().int().nonnegative(),
            proxied: z.boolean(),
        }),
    ),
    /** Existing project domain bindings (subdomain + basePath + full URL). */
    projectDomains: z.array(
        z.object({
            id: z.string(),
            domain: z.string(),
            allowedSubdomains: z.array(z.string()),
            isPrimary: z.boolean(),
            existingMappings: z.array(
                z.object({
                    serviceId: z.string(),
                    serviceName: z.string(),
                    subdomain: z.string().nullable(),
                    basePath: z.string().nullable(),
                    fullUrl: z.string(),
                }),
            ),
        }),
    ),
});

export const serviceUpdateNetworkInputSchema = z
    .object({
        dnsProviderId: z.string().nullable().optional(),
        zoneId: z.string().nullable().optional(),
        zoneName: z.string().nullable().optional(),
        recordType: z.enum(["A", "AAAA", "CNAME", "TXT"]).optional(),
        recordContent: z.string().nullable().optional(),
        proxied: z.boolean().optional(),
        autoProvision: z.boolean().optional(),
        expose: z.boolean().optional(),
        tls: z
            .object({
                enabled: z.boolean().optional(),
                httpRedirect: z.boolean().optional(),
            })
            .optional(),
    });

/** Body for provisioning a DNS record for this service in the resolved zone. */
export const serviceProvisionDnsRecordInputSchema = z
    .object({
        /** Full record name, e.g. "api.example.com" (or "api" for zone-root). */
        name: z.string().min(1),
        type: z.enum(["A", "AAAA", "CNAME", "TXT"]),
        content: z.string().min(1),
        ttl: z.number().int().nonnegative().optional(),
        proxied: z.boolean().optional(),
    });

const serviceNetworkOps = standard.zod(serviceNetworkViewSchema, "serviceNetwork");

/** GET /services/:id/network — service network config + resolved zone context. */
export const serviceGetNetworkContract = serviceNetworkOps
    .read()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/network`))
    .output(serviceNetworkViewSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** PUT /services/:id/network — update service network config (overrides project). */
export const serviceUpdateNetworkContract = serviceNetworkOps
    .update()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/network`)
            .body(serviceUpdateNetworkInputSchema),
    )
    .output(serviceNetworkViewSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

const serviceRecordOps = standard.zod(serviceNetworkViewSchema, "serviceNetworkRecord");

/** POST /services/:id/network/records — auto-provision a DNS record via the provider. */
export const serviceProvisionDnsRecordContract = serviceRecordOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/network/records`)
            .body(serviceProvisionDnsRecordInputSchema),
    )
    .output(
        z.object({
            success: z.boolean(),
            record: z
                .object({
                    id: z.string(),
                    zoneId: z.string(),
                    name: z.string(),
                    type: z.enum(["A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI"]),
                    content: z.string(),
                    ttl: z.number().int().nonnegative(),
                    proxied: z.boolean(),
                })
                .nullable(),
            message: z.string(),
        }),
    )
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export type ServiceNetworkView = z.infer<typeof serviceNetworkViewSchema>;
export type ServiceUpdateNetworkInput = z.infer<typeof serviceUpdateNetworkInputSchema>;
export type ServiceProvisionDnsRecordInput = z.infer<typeof serviceProvisionDnsRecordInputSchema>;

import { oc } from "@orpc/contract";

/** Aggregate service network router: get/update/provision records. */
export const serviceNetworkContract = oc.tag("Service Network").router({
    get: serviceGetNetworkContract,
    update: serviceUpdateNetworkContract,
    provisionRecord: serviceProvisionDnsRecordContract,
});
