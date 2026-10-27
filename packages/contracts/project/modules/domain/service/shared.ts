import { standard } from "@deployer/orpc-utils";
import {
    checkSubdomainAvailabilitySchema,
    serviceDomainWithFullUrlSchema,
} from "../schemas";

export const serviceDomainOps = standard.zod(serviceDomainWithFullUrlSchema, "serviceDomain");
export const checkSubdomainAvailabilityOps = standard.zod(
    checkSubdomainAvailabilitySchema,
    "checkSubdomainAvailability",
);
