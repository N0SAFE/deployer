import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectResourceConfigSchema } from "@deployer/contracts-entities";
 
const projectResourceConfigOps = standard.zod(projectResourceConfigSchema, "projectResourceConfig");

export const projectGetResourceConfigContract = projectResourceConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/resource`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
