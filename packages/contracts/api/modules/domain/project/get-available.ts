import z from "zod/v4";
import { availableDomainOps } from "./shared";

export const getAvailableDomainsInput = z.object({
    projectId: z.uuid(),
});

export const getAvailableDomainsContract = availableDomainOps
    .list()
    .path("/projects/{projectId}/domains/available")
    .input((b) =>
        b
            .params((p) => p`/${p("projectId", z.uuid())}/domains/available`)
            .query(z.object({})),
    )
    .output((b) => z.array(b.entitySchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";