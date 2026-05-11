import z from "zod/v4";
import { serviceDomainOps } from "./shared";

export const listServiceDomainsInput = z.object({
    serviceId: z.uuid(),
});

export const listServiceDomainsContract = serviceDomainOps
    .list()
    .input((b) => b.params((p) => p`/${p("serviceId", z.uuid())}/domains`))
    .output((b) => z.array(b.entitySchema))
    .build();
