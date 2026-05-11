import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectGeneralConfigSchema } from "@repo/contracts-entities";
 
const projectGeneralConfigOps = standard.zod(projectGeneralConfigSchema, "projectGeneralConfig");

export const projectGetGeneralConfigContract = projectGeneralConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/general`))
    .build();
