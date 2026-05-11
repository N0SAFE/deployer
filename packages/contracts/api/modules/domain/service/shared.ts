import { standard } from "@repo/orpc-utils";
import {
    checkSubdomainAvailabilitySchema,
    serviceDomainWithFullUrlSchema,
} from "../schemas";

export const serviceDomainOps = standard.zod(serviceDomainWithFullUrlSchema, "serviceDomain");
export const checkSubdomainAvailabilityOps = standard.zod(
    checkSubdomainAvailabilitySchema,
    "checkSubdomainAvailability",
);
