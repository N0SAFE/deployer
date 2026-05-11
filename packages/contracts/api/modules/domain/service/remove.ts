import z from "zod/v4";
import { serviceDomainOps } from "./shared";

export const removeServiceDomainInput = z.object({
    serviceId: z.uuid(),
    mappingId: z.uuid(),
});

export const removeServiceDomainOutput = z.object({
    success: z.boolean(),
    message: z.string(),
});

export const removeServiceDomainContract = serviceDomainOps
    .delete({ idFieldName: "mappingId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) => p`/${p("serviceId", z.uuid())}/domains/${p("mappingId", z.uuid())}`,
        ),
    )
    .output(removeServiceDomainOutput)
    .build();
