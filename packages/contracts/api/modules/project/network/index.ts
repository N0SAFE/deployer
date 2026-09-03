import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectNetworkConfigSchema } from "@repo/contracts-entities";

/** Read model — config + DNS provider discovery (providers, zones, records). */
export const projectNetworkViewSchema = z.object({
    network: projectNetworkConfigSchema.nullable(),
    /** DNS provider accounts available to this user (global, active). */
    providers: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            providerType: z.string(),
            isActive: z.boolean(),
            features: z.object({
                dnsManagement: z.boolean().default(true),
                tunnelManagement: z.boolean().default(false),
            }),
            state: z
                .object({
                    status: z.enum(["ok", "error", "unknown"]),
                    checkedAt: z.string().nullable(),
                    accountId: z.string().nullable(),
                    tokenValid: z.boolean().nullable(),
                    error: z.string().nullable(),
                })
                .nullable(),
        }),
    ),
    /** Zones fetched live from the selected provider. */
    zones: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            status: z.string(),
            nameServers: z.array(z.string()),
        }),
    ),
    /** DNS records already present in the selected zone (live). */
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
    /** This project's verified domains (candidates for base domain). */
    projectDomains: z.array(
        z.object({
            id: z.string(),
            domain: z.string(),
            allowedSubdomains: z.array(z.string()),
            isPrimary: z.boolean(),
        }),
    ),
});

export const projectUpdateNetworkInputSchema = z
    .object({
        /** Select a provider account — forces re-fetch of its zones. */
        dnsProviderId: z.string().min(1).optional(),
        /** Select a zone within the provider (zone name becomes baseDomain). */
        zoneId: z.string().min(1).optional(),
        /** Zone name (read-model, kept in sync server-side). */
        zoneName: z.string().optional(),
        autoProvisionRecords: z.boolean().optional(),
        proxiedDefault: z.boolean().optional(),
        wildcardSubdomains: z.boolean().optional(),
        recordType: z.enum(["A", "AAAA", "CNAME", "TXT"]).optional(),
        recordContent: z.string().nullable().optional(),
    });

const projectNetworkOps = standard.zod(projectNetworkViewSchema, "projectNetwork");

/** GET /projects/:id/network — current config + provider/zone/record discovery. */
export const projectGetNetworkContract = projectNetworkOps
    .read()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/network`))
    .output(projectNetworkViewSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** PUT /projects/:id/network — update provider/zone/record policy. */
export const projectUpdateNetworkContract = projectNetworkOps
    .update()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/network`)
            .body(projectUpdateNetworkInputSchema),
    )
    .output(projectNetworkViewSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

export type ProjectNetworkView = z.infer<typeof projectNetworkViewSchema>;
export type ProjectUpdateNetworkInput = z.infer<typeof projectUpdateNetworkInputSchema>;
