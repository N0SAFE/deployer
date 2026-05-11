import z from "zod/v4";
import { serviceDomainOps } from "./shared";

export const setPrimaryServiceDomainInput = z.object({
    serviceId: z.uuid(),
    mappingId: z.uuid(),
});

export const setPrimaryServiceDomainContract = serviceDomainOps
    .update({ idFieldName: "mappingId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) => p`/${p("serviceId", z.uuid())}/domains/${p("mappingId", z.uuid())}/primary`,
        ),
    )
    .output((b) => b.entitySchema)
    .build();
