import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectSecurityConfigSchema } from "@repo/contracts-entities";
 
const projectSecurityConfigOps = standard.zod(projectSecurityConfigSchema, "projectSecurityConfig");

export const projectGetSecurityConfigContract = projectSecurityConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/security`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
