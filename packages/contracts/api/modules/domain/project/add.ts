import z from "zod/v4";
import { addProjectDomainSchema, projectDomainWithOrgDomainSchema } from "../schemas";
import { projectDomainOps } from "./shared";

export const addProjectDomainOutput = z.object({
    projectDomain: projectDomainWithOrgDomainSchema,
    suggestions: z.object({
        commonSubdomains: z.array(z.string()),
        wildcardOption: z.string(),
    }),
});

export const addProjectDomainContract = projectDomainOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("projectId", z.uuid())}/domains`)
            .body(
                z.object({
                    organizationDomainId: addProjectDomainSchema.shape.organizationDomainId,
                    allowedSubdomains: addProjectDomainSchema.shape.allowedSubdomains,
                    isPrimary: addProjectDomainSchema.shape.isPrimary,
                }),
            ),
    )
    .output(addProjectDomainOutput)
    .build();
