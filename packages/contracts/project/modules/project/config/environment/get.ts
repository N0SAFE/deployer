import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectEnvironmentConfigSchema } from "@deployer/contracts-entities";
 
const projectEnvironmentConfigOps = standard.zod(projectEnvironmentConfigSchema, "projectEnvironmentConfig");

export const projectGetEnvironmentConfigContract = projectEnvironmentConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/environment`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
