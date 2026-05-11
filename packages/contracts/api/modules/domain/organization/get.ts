import z from "zod/v4";
import { organizationDomainOps } from "./shared";

export const getOrganizationDomainInput = z.object({
    organizationId: z.uuid(),
    domainId: z.uuid(),
});

export const getOrganizationDomainContract = organizationDomainOps
    .read({ idFieldName: "domainId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) => p`/${p("organizationId", z.uuid())}/domains/${p("domainId", z.uuid())}`,
        ),
    )
    .output((b) => b.entitySchema)
    .build();
