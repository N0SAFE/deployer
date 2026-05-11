import z from "zod/v4";
import { addServiceDomainResponseSchema, addServiceDomainSchema } from "../schemas";
import { serviceDomainOps } from "./shared";

export const addServiceDomainContract = serviceDomainOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("serviceId", z.uuid())}/domains`)
            .body(
                z.object({
                    projectDomainId: addServiceDomainSchema.shape.projectDomainId,
                    subdomain: addServiceDomainSchema.shape.subdomain,
                    basePath: addServiceDomainSchema.shape.basePath,
                    isPrimary: addServiceDomainSchema.shape.isPrimary,
                    sslEnabled: addServiceDomainSchema.shape.sslEnabled,
                    sslProvider: addServiceDomainSchema.shape.sslProvider,
                }),
            ),
    )
    .output(addServiceDomainResponseSchema)
    .build();
