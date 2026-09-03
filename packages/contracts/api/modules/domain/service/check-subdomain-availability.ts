import { checkSubdomainAvailabilitySchema, subdomainAvailabilityResponseSchema } from "../schemas";
import { checkSubdomainAvailabilityOps } from "./shared";

export const checkSubdomainAvailabilityContract = checkSubdomainAvailabilityOps
    .create()
    .path("/check-subdomain")
    .input((b) =>
        b.entitySchema.extend({
            subdomain: checkSubdomainAvailabilitySchema.shape.subdomain,
            basePath: checkSubdomainAvailabilitySchema.shape.basePath,
            excludeServiceId: checkSubdomainAvailabilitySchema.shape.excludeServiceId,
        }),
    )
    .output(subdomainAvailabilityResponseSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";