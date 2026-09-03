import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectEnvironmentConfigSchema } from "@repo/contracts-entities";
 
const projectEnvironmentConfigOps = standard.zod(projectEnvironmentConfigSchema, "projectEnvironmentConfig");

export const projectGetEnvironmentConfigContract = projectEnvironmentConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/environment`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
