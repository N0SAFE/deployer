import z from "zod/v4";
import { projectDomainOps } from "./shared";
import { verifyDomainResponseSchema } from "../schemas";

export const verifyProjectDomainInput = z.object({
    projectId: z.uuid(),
    domainId: z.uuid(),
});

export const verifyProjectDomainContract = projectDomainOps
    .update({ idFieldName: "domainId" })
    .path('/projects/{projectId}/domains/{domainId}/verify')
    .input((b) =>
        b.params(
            (p) => p`/${p("projectId", z.uuid())}/domains/${p("domainId", z.uuid())}/verify`,
        ),
    )
    .output(verifyDomainResponseSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";