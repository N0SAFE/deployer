import z from "zod/v4";
import { addDomainResponseSchema, addOrganizationDomainSchema } from "../schemas";
import { organizationDomainOps } from "./shared";

export const addOrganizationDomainContract = organizationDomainOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("organizationId", z.uuid())}/domains`)
            .body(
                z.object({
                    domain: addOrganizationDomainSchema.shape.domain,
                    verificationMethod: addOrganizationDomainSchema.shape.verificationMethod,
                }),
            ),
    )
    .output(addDomainResponseSchema)
    .build();
