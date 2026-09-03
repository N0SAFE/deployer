import * as z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceEnvironmentLinkInputSchema } from "@repo/contracts-entities";

/**
 * SERVICE × ENVIRONMENT LINK CRUD.
 *
 * A service participates in an environment (isEnabled) with optional
 * per-service-per-env overrides (replicas, strategy, dependency link policy).
 * This is the "link services to environments" primitive: the same service can
 * run 3 replicas in production and 1 in preview.
 */
const serviceEnvironmentLinkOutputSchema = z.object({
    links: z.array(
        z.object({
            id: z.uuid(),
            serviceId: z.uuid(),
            environmentId: z.uuid(),
            isEnabled: z.boolean(),
            overrides: z.record(z.string(), z.unknown()).nullable(),
            serviceName: z.string(),
            environmentName: z.string(),
            environmentKind: z.enum(["stable", "preview", "ephemeral"]),
        }),
    ),
});

const serviceEnvLinkOps = standard.zod(serviceEnvironmentLinkOutputSchema, "serviceEnvironmentLinks");

/** List all service×environment links for a project. */
export const projectListServiceEnvironmentLinksContract = serviceEnvLinkOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/service-environment-links`))
    .output(serviceEnvironmentLinkOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

/** Upsert a service×environment link (enable/disable + overrides). */
export const projectUpsertServiceEnvironmentLinkContract = serviceEnvLinkOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/service-environment-links`)
            .body(serviceEnvironmentLinkInputSchema),
    )
    .output(
        z.object({
            id: z.uuid(),
            serviceId: z.uuid(),
            environmentId: z.uuid(),
            isEnabled: z.boolean(),
            overrides: z.record(z.string(), z.unknown()).nullable(),
        }),
    )
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
