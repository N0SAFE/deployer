import { standard } from "@repo/orpc-utils";
import { availableDomainSchema, projectDomainWithMappingsSchema, projectDomainWithOrgDomainSchema } from "../schemas";

export const projectDomainOps = standard.zod(projectDomainWithOrgDomainSchema, "projectDomain");
export const availableDomainOps = standard.zod(availableDomainSchema, "availableDomain");
export const projectDomainMappingsOps = standard.zod(projectDomainWithMappingsSchema, "projectDomainMappings");
