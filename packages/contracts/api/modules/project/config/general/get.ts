import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectGeneralConfigSchema } from "@repo/contracts-entities";
 
const projectGeneralConfigOps = standard.zod(projectGeneralConfigSchema, "projectGeneralConfig");

export const projectGetGeneralConfigContract = projectGeneralConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/general`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
