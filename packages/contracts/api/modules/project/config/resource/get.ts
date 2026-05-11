import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectResourceConfigSchema } from "@repo/contracts-entities";
 
const projectResourceConfigOps = standard.zod(projectResourceConfigSchema, "projectResourceConfig");

export const projectGetResourceConfigContract = projectResourceConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/resource`))
    .build();
