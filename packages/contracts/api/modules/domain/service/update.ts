import z from "zod/v4";
import { updateServiceDomainSchema } from "../schemas";
import { serviceDomainOps } from "./shared";

export const updateServiceDomainInput = z.object({
    serviceId: z.uuid(),
    mappingId: z.uuid(),
    ...updateServiceDomainSchema.shape,
});

export const updateServiceDomainContract = serviceDomainOps
    .update({ idFieldName: "mappingId", idSchema: z.uuid() })
    .input((b) =>
        b
            .params(
                (p) => p`/${p("serviceId", z.uuid())}/domains/${p("mappingId", z.uuid())}`,
            )
            .body(z.object(updateServiceDomainSchema.shape)),
    )
    .output((b) => b.entitySchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";