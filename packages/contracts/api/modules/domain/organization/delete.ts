import z from "zod/v4";
import { organizationDomainOps } from "./shared";

export const deleteOrganizationDomainInput = z.object({
    organizationId: z.uuid(),
    domainId: z.uuid(),
});

export const deleteOrganizationDomainOutput = z.object({
    success: z.boolean(),
    message: z.string(),
});

export const deleteOrganizationDomainContract = organizationDomainOps
    .delete({ idFieldName: "domainId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) => p`/${p("organizationId", z.uuid())}/domains/${p("domainId", z.uuid())}`,
        ),
    )
    .output(deleteOrganizationDomainOutput)
    .build();
