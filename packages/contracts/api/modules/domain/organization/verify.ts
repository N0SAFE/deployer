import z from "zod/v4";
import { verifyDomainResponseSchema } from "../schemas";
import { organizationDomainOps } from "./shared";

export const verifyOrganizationDomainInput = z.object({
    organizationId: z.uuid(),
    domainId: z.uuid(),
});

export const verifyOrganizationDomainContract = organizationDomainOps
    .create()
    .input((b) =>
        b.params(
            (p) => p`/${p("organizationId", z.uuid())}/domains/${p("domainId", z.uuid())}/verify`,
        ),
    )
    .output(verifyDomainResponseSchema)
    .build();
