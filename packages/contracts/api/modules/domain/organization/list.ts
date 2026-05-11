import { standard } from "@repo/orpc-utils";
import z from "zod/v4";
import { organizationDomainSchema, verificationStatusSchema } from "../schemas";

export const listOrganizationDomainsInput = z.object({
    organizationId: z.uuid(),
    verificationStatus: verificationStatusSchema.optional(),
});

const organizationListOps = standard.zod(organizationDomainSchema, "organizationDomainList");

export const listOrganizationDomainsContract = organizationListOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("organizationId", z.uuid())}/domains`)
            .query(
                z.object({
                    verificationStatus: verificationStatusSchema.optional(),
                }),
            ),
    )
    .output((b) => z.array(b.entitySchema))
    .build();
