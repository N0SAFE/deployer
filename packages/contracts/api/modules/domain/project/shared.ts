import { standard } from "@repo/orpc-utils";
import { availableDomainSchema, projectDomainSchema, projectDomainWithMappingsSchema } from "../schemas";

export const projectDomainOps = standard.zod(projectDomainSchema, "projectDomain");
export const availableDomainOps = standard.zod(availableDomainSchema, "availableDomain");
export const projectDomainMappingsOps = standard.zod(projectDomainWithMappingsSchema, "projectDomainMappings");
