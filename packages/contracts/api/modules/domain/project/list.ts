import z from "zod/v4";
import { projectDomainOps } from "./shared";

export const listProjectDomainsInput = z.object({
    projectId: z.uuid(),
});

export const listProjectDomainsContract = projectDomainOps
    .list()
    .input((b) => b.params((p) => p`/${p("projectId", z.uuid())}/domains`))
    .output((b) => z.array(b.entitySchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";