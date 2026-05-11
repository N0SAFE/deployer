import z from "zod/v4";
import { availableDomainOps } from "./shared";

export const getAvailableDomainsInput = z.object({
    organizationId: z.uuid(),
    projectId: z.uuid(),
});

export const getAvailableDomainsContract = availableDomainOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("organizationId", z.uuid())}/domains/available`)
            .query(
                z.object({
                    projectId: z.uuid(),
                }),
            ),
    )
    .output((b) => z.array(b.entitySchema))
    .build();
