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
    .meta(access({ permission: "domain:read" }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";