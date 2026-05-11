import { standard } from "@repo/orpc-utils";
import { organizationDomainSchema } from "../schemas";

export const organizationDomainOps = standard.zod(organizationDomainSchema, "organizationDomain");
