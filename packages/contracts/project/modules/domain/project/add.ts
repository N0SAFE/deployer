import z from "zod/v4";

import { addProjectDomainSchema, projectDomainWithVerificationSchema } from "../schemas";

import { projectDomainOps } from "./shared";

export const addProjectDomainOutput = z.object({
    projectDomain: projectDomainWithVerificationSchema,
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
                    domain: addProjectDomainSchema.shape.domain,
                    verificationMethod: addProjectDomainSchema.shape.verificationMethod,
                    allowedSubdomains: addProjectDomainSchema.shape.allowedSubdomains,
                    isPrimary: addProjectDomainSchema.shape.isPrimary,
                }),
            ),
    )
    .output(addProjectDomainOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "domain:write", scope: { by: "input", path: "params.projectId", kind: "project" } }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";